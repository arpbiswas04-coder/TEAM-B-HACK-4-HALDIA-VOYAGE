const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Ensure data directory exists
const defaultDataDir = path.join(__dirname, "../data");
if (!fs.existsSync(defaultDataDir)) {
  fs.mkdirSync(defaultDataDir, { recursive: true });
}

// Preserve existing root database if present
const rootDbPath = path.join(__dirname, "../whiteboard.db");
const targetDbPath = path.join(defaultDataDir, "whiteboard.db");

if (fs.existsSync(rootDbPath) && !fs.existsSync(targetDbPath)) {
  try {
    fs.copyFileSync(rootDbPath, targetDbPath);
  } catch (err) {
    console.warn("Could not copy root whiteboard.db to data/whiteboard.db:", err.message);
  }
}

const DB_PATH = process.env.DB_PATH || targetDbPath;
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Optimize database for concurrent read/writes
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// Setup schema
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS strokes (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT 'pen',
    color TEXT NOT NULL DEFAULT '#202020',
    size REAL NOT NULL DEFAULT 4,
    points TEXT NOT NULL,
    is_undone INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_strokes_room_active ON strokes(room_id, is_undone, created_at);
  CREATE INDEX IF NOT EXISTS idx_strokes_user ON strokes(room_id, user_id, is_undone, created_at);
`);

// Prepared statements for high performance
const stmtGetRoom = db.prepare("SELECT * FROM rooms WHERE id = ?");
const stmtInsertRoom = db.prepare(
  "INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
);
const stmtTouchRoom = db.prepare(
  "UPDATE rooms SET updated_at = ? WHERE id = ?"
);
const stmtGetActiveStrokes = db.prepare(
  "SELECT id, room_id AS roomId, user_id AS userId, user_name AS userName, tool, color, size, points, created_at AS createdAt FROM strokes WHERE room_id = ? AND is_undone = 0 ORDER BY created_at ASC"
);
const stmtInsertStroke = db.prepare(`
  INSERT OR REPLACE INTO strokes (id, room_id, user_id, user_name, tool, color, size, points, is_undone, created_at)
  VALUES (@id, @roomId, @userId, @userName, @tool, @color, @size, @points, 0, @createdAt)
`);
const stmtLatestUserStroke = db.prepare(`
  SELECT id FROM strokes
  WHERE room_id = ? AND user_id = ? AND is_undone = 0
  ORDER BY created_at DESC
  LIMIT 1
`);
const stmtMarkStrokeUndone = db.prepare(
  "UPDATE strokes SET is_undone = 1 WHERE id = ?"
);
const stmtLatestUndoneUserStroke = db.prepare(`
  SELECT id, room_id AS roomId, user_id AS userId, user_name AS userName, tool, color, size, points, created_at AS createdAt
  FROM strokes
  WHERE room_id = ? AND user_id = ? AND is_undone = 1
  ORDER BY created_at DESC
  LIMIT 1
`);
const stmtMarkStrokeRedone = db.prepare(
  "UPDATE strokes SET is_undone = 0 WHERE id = ?"
);
const stmtClearRoomStrokes = db.prepare(
  "UPDATE strokes SET is_undone = 1 WHERE room_id = ? AND is_undone = 0"
);
const stmtCountStrokes = db.prepare(
  "SELECT count(*) as count FROM strokes WHERE room_id = ? AND is_undone = 0"
);

function getRoom(id) {
  return stmtGetRoom.get(id);
}

function createRoom(id, name = "Untitled FUNBOARD") {
  const now = Date.now();
  stmtInsertRoom.run(id, name, now, now);
  return { id, name, created_at: now, updated_at: now };
}

function ensureRoom(id, name = "Untitled FUNBOARD") {
  const existing = getRoom(id);
  if (existing) return existing;
  return createRoom(id, name);
}

function parseStrokeRow(r) {
  try {
    const parsed = JSON.parse(r.points);
    if (Array.isArray(parsed)) {
      return {
        ...r,
        points: parsed,
        fillColor: "transparent",
        text: "",
      };
    } else {
      return {
        ...r,
        points: parsed.pts || [],
        fillColor: parsed.fillColor || "transparent",
        text: parsed.text || "",
        dash: parsed.dash || false,
      };
    }
  } catch {
    return {
      ...r,
      points: [],
      fillColor: "transparent",
      text: "",
    };
  }
}

function getRoomStrokes(roomId) {
  const rows = stmtGetActiveStrokes.all(roomId);
  return rows.map(parseStrokeRow);
}

function ping() {
  try {
    const res = db.prepare("SELECT 1 as ok").get();
    return Boolean(res && res.ok === 1);
  } catch {
    return false;
  }
}

function saveStroke(stroke) {
  const now = stroke.createdAt || Date.now();
  let pointsStr;

  if (typeof stroke.points === "string") {
    pointsStr = stroke.points;
  } else {
    // Sanitize numeric point coordinates to avoid NaN or malformed entries
    const rawPts = Array.isArray(stroke.points) ? stroke.points : [];
    const sanitizedPts = rawPts.map((p) => ({
      x: Number.isFinite(Number(p.x)) ? Number(p.x) : 0,
      y: Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
    }));

    // Pack rich stroke properties (points array, fill, text, dash)
    const pointsData = {
      pts: sanitizedPts,
      fillColor: stroke.fillColor || "transparent",
      text: stroke.text || "",
      dash: Boolean(stroke.dash),
    };
    pointsStr = JSON.stringify(pointsData);
  }

  const payload = {
    id: stroke.id,
    roomId: stroke.roomId,
    userId: stroke.userId,
    userName: stroke.userName || "Anonymous",
    tool: stroke.tool || "pen",
    color: stroke.color || "#202020",
    size: Number(stroke.size) || 4,
    points: pointsStr,
    createdAt: now,
  };

  stmtInsertStroke.run(payload);
  stmtTouchRoom.run(now, stroke.roomId);
  return {
    ...payload,
    points: stroke.points || [],
    fillColor: stroke.fillColor || "transparent",
    text: stroke.text || "",
    dash: stroke.dash || false,
  };
}

function undoUserStroke(roomId, userId) {
  const row = stmtLatestUserStroke.get(roomId, userId);
  if (!row) return null;
  stmtMarkStrokeUndone.run(row.id);
  return row.id;
}

function redoUserStroke(roomId, userId) {
  const row = stmtLatestUndoneUserStroke.get(roomId, userId);
  if (!row) return null;
  stmtMarkStrokeRedone.run(row.id);
  return parseStrokeRow(row);
}

function clearRoomStrokes(roomId) {
  const result = stmtClearRoomStrokes.run(roomId);
  stmtTouchRoom.run(Date.now(), roomId);
  return result.changes;
}

function getStrokeCount(roomId) {
  const res = stmtCountStrokes.get(roomId);
  return res ? res.count : 0;
}

module.exports = {
  db,
  DB_PATH,
  getRoom,
  createRoom,
  ensureRoom,
  getRoomStrokes,
  saveStroke,
  undoUserStroke,
  redoUserStroke,
  clearRoomStrokes,
  getStrokeCount,
  ping,
};
