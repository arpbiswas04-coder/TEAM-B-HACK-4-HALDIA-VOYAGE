try {
  require("dotenv").config();
} catch (e) {}

const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const db = require("./db");

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 5e6, // 5MB payload limit
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Serve frontend assets cleanly from ../frontend
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

// Generate clean readable room IDs (e.g. room-7f2a8c)
function generateRoomId() {
  const bytes = crypto.randomBytes(4).toString("hex");
  return `room-${bytes}`;
}

// In-memory tracking of active participants per room: Map<roomId, Map<socketId, Participant>>
const activeParticipants = new Map();

function getRoomParticipantsList(roomId) {
  const roomMap = activeParticipants.get(roomId);
  if (!roomMap) return [];
  // Deduplicate by userId so multiple tabs or fast reconnects don't artificially inflate count
  const byUser = new Map();
  for (const p of roomMap.values()) {
    byUser.set(p.userId, p);
  }
  return Array.from(byUser.values());
}

function removeSocketFromParticipants(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;
  const roomMap = activeParticipants.get(roomId);
  if (roomMap) {
    roomMap.delete(socket.id);
    if (roomMap.size === 0) {
      activeParticipants.delete(roomId);
    } else {
      const list = getRoomParticipantsList(roomId);
      io.to(roomId).emit("presence-update", {
        count: list.length,
        participants: list,
      });
    }
  }
  if (socket.userId) {
    socket.to(roomId).emit("remote-cursor-remove", { userId: socket.userId });
  }
}

// ---------------- REST API ----------------

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.get("/health", (req, res) => {
  const dbHealthy = db.ping();
  const status = dbHealthy ? "ok" : "degraded";
  res.status(dbHealthy ? 200 : 503).json({
    status,
    project: "FUNBOARD: Collaborative Whiteboard",
    stack: "node",
    uptime: Math.floor(process.uptime()),
    database: dbHealthy ? "connected" : "error",
    timestamp: Date.now(),
  });
});

app.post("/api/rooms", (req, res) => {
  try {
    const { name, customId } = req.body || {};
    let roomId = customId ? String(customId).trim().toLowerCase() : generateRoomId();

    // Validate room ID format
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
      return res.status(400).json({
        error: "Invalid room ID. Must be 3-64 characters (letters, numbers, hyphens, underscores).",
      });
    }

    const existing = db.getRoom(roomId);
    if (existing && customId) {
      return res.status(409).json({ error: "Room with this ID already exists." });
    }

    const room = existing || db.createRoom(roomId, name ? String(name).slice(0, 100) : "FUNBOARD " + roomId);
    res.status(201).json({
      roomId: room.id,
      name: room.name,
      createdAt: room.created_at,
    });
  } catch (err) {
    console.error("Error creating room:", err);
    res.status(500).json({ error: "Failed to create room." });
  }
});

app.get("/api/rooms/:id", (req, res) => {
  try {
    const roomId = String(req.params.id).trim().toLowerCase();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
      return res.status(400).json({ error: "Invalid room ID format." });
    }

    const room = db.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found." });
    }

    const strokes = db.getRoomStrokes(roomId);
    res.json({
      roomId: room.id,
      name: room.name,
      createdAt: room.created_at,
      updatedAt: room.updated_at,
      strokeCount: strokes.length,
      strokes,
    });
  } catch (err) {
    console.error("Error fetching room:", err);
    res.status(500).json({ error: "Failed to fetch room state." });
  }
});

app.post("/api/rooms/:id/clear", (req, res) => {
  try {
    const roomId = String(req.params.id).trim().toLowerCase();
    const room = db.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found." });
    }

    db.clearRoomStrokes(roomId);
    io.to(roomId).emit("board-cleared", {
      clearedBy: "API request",
      timestamp: Date.now(),
    });

    res.json({ success: true, roomId });
  } catch (err) {
    console.error("Error clearing room:", err);
    res.status(500).json({ error: "Failed to clear room." });
  }
});

// ---------------- Real-Time Socket.IO ----------------

io.on("connection", (socket) => {
  // Join room event
  socket.on("join-room", ({ roomId, userId, userName, userColor }) => {
    try {
      if (!roomId || !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
        return socket.emit("error-msg", { message: "Invalid room ID format." });
      }

      const cleanRoomId = String(roomId).trim().toLowerCase();

      // Verify room exists in persistent SQLite
      const room = db.getRoom(cleanRoomId);
      if (!room) {
        return socket.emit("room-not-found", {
          roomId: cleanRoomId,
          message: `Room "${cleanRoomId}" does not exist. Please create it first.`,
        });
      }

      // If socket was in another room, leave it cleanly first
      if (socket.roomId && socket.roomId !== cleanRoomId) {
        removeSocketFromParticipants(socket);
        socket.leave(socket.roomId);
      }

      socket.roomId = cleanRoomId;
      socket.userId = (userId && String(userId).slice(0, 64)) || socket.id;
      socket.userName = (userName && String(userName).slice(0, 30)) || "Anonymous";
      socket.userColor = (userColor && String(userColor).slice(0, 32)) || "#4568F5";

      socket.join(cleanRoomId);

      // Register participant
      if (!activeParticipants.has(cleanRoomId)) {
        activeParticipants.set(cleanRoomId, new Map());
      }
      activeParticipants.get(cleanRoomId).set(socket.id, {
        socketId: socket.id,
        userId: socket.userId,
        userName: socket.userName,
        userColor: socket.userColor,
      });

      const strokes = db.getRoomStrokes(cleanRoomId);
      const participants = getRoomParticipantsList(cleanRoomId);

      // Send authoritative state to client (including late joiners)
      socket.emit("room-init", {
        roomId: room.id,
        roomName: room.name,
        strokes,
        participants,
      });

      // Broadcast updated presence to room
      io.to(cleanRoomId).emit("presence-update", {
        count: participants.length,
        participants,
      });

      // Broadcast welcome notification to others
      socket.to(cleanRoomId).emit("user-joined", {
        userId: socket.userId,
        userName: socket.userName,
      });
    } catch (err) {
      console.error("Error in join-room:", err);
      socket.emit("error-msg", { message: "Failed to join room." });
    }
  });

  // Live stroke start preview (shapes, freehand, etc.)
  socket.on("stroke-start", (data) => {
    if (!socket.roomId || !data || !data.point) return;
    const pt = {
      x: Number.isFinite(Number(data.point.x)) ? Number(data.point.x) : 0,
      y: Number.isFinite(Number(data.point.y)) ? Number(data.point.y) : 0,
    };
    socket.to(socket.roomId).emit("remote-stroke-start", {
      ...data,
      point: pt,
      userId: socket.userId,
      userName: socket.userName,
    });
  });

  // Live stroke movement / shape preview
  socket.on("stroke-move", (data) => {
    if (!socket.roomId || !data || !data.point) return;
    const pt = {
      x: Number.isFinite(Number(data.point.x)) ? Number(data.point.x) : 0,
      y: Number.isFinite(Number(data.point.y)) ? Number(data.point.y) : 0,
    };
    socket.to(socket.roomId).emit("remote-stroke-move", {
      ...data,
      point: pt,
      userId: socket.userId,
    });
  });

  // Stroke completion and persistence
  socket.on("stroke-end", (stroke, callback) => {
    try {
      if (!socket.roomId || !stroke) {
        if (typeof callback === "function") callback({ error: "Not joined to a room" });
        return;
      }
      const roomId = socket.roomId;

      // Validate stroke payload
      if (!stroke.id || typeof stroke.id !== "string") {
        if (typeof callback === "function") callback({ error: "Invalid stroke ID" });
        return;
      }

      if (Array.isArray(stroke.points) && stroke.points.length > 25000) {
        if (typeof callback === "function") callback({ error: "Stroke exceeds point limit" });
        return;
      }

      const validTools = ["pen", "marker", "highlighter", "dashed", "eraser", "rect", "circle", "line", "arrow", "text"];
      const tool = validTools.includes(stroke.tool) ? stroke.tool : "pen";

      const strokeRecord = {
        id: String(stroke.id).slice(0, 128),
        roomId: roomId, // strictly enforce socket's joined roomId
        userId: socket.userId,
        userName: socket.userName,
        tool,
        color: String(stroke.color || "#202020").slice(0, 32),
        fillColor: String(stroke.fillColor || "transparent").slice(0, 32),
        size: Math.max(1, Math.min(100, Number(stroke.size) || 4)),
        points: Array.isArray(stroke.points) ? stroke.points : [],
        text: stroke.text ? String(stroke.text).slice(0, 1000) : "",
        dash: Boolean(stroke.dash),
        createdAt: stroke.createdAt || Date.now(),
      };

      // Persist in SQLite
      const saved = db.saveStroke(strokeRecord);

      // Broadcast committed stroke to other clients in room
      socket.to(roomId).emit("stroke-committed", saved);

      if (typeof callback === "function") {
        callback({ success: true, strokeId: saved.id });
      }
    } catch (err) {
      console.error("Error committing stroke:", err);
      if (typeof callback === "function") callback({ error: "Database error" });
    }
  });

  // Live cursor position
  socket.on("cursor-move", (pos) => {
    if (!socket.roomId || !pos) return;
    socket.to(socket.roomId).emit("remote-cursor", {
      userId: socket.userId,
      userName: socket.userName,
      color: socket.userColor,
      x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0,
      y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0,
    });
  });

  // Per-user Undo
  socket.on("undo", () => {
    try {
      if (!socket.roomId || !socket.userId) return;
      const undoneStrokeId = db.undoUserStroke(socket.roomId, socket.userId);
      if (undoneStrokeId) {
        io.to(socket.roomId).emit("stroke-undone", {
          strokeId: undoneStrokeId,
          userId: socket.userId,
        });
      }
    } catch (err) {
      console.error("Error handling undo:", err);
    }
  });

  // Per-user Redo
  socket.on("redo", () => {
    try {
      if (!socket.roomId || !socket.userId) return;
      const restoredStroke = db.redoUserStroke(socket.roomId, socket.userId);
      if (restoredStroke) {
        io.to(socket.roomId).emit("stroke-redone", {
          stroke: restoredStroke,
          userId: socket.userId,
        });
      }
    } catch (err) {
      console.error("Error handling redo:", err);
    }
  });

  // Clear board
  socket.on("clear-board", () => {
    try {
      if (!socket.roomId) return;
      db.clearRoomStrokes(socket.roomId);
      io.to(socket.roomId).emit("board-cleared", {
        clearedBy: socket.userName,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Error clearing board:", err);
    }
  });

  // Leave room cleanly
  socket.on("leave-room", () => {
    removeSocketFromParticipants(socket);
    if (socket.roomId) {
      socket.leave(socket.roomId);
      socket.roomId = null;
    }
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    removeSocketFromParticipants(socket);
  });
});

// SPA Fallback for client-side routing
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.includes(".")) {
    return next();
  }
  res.sendFile(path.join(frontendPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`FUNBOARD server running on http://${HOST}:${PORT}`);
  });
}

module.exports = { app, server };
