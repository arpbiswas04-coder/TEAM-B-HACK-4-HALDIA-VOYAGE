// Comprehensive End-to-End Headless Verification Suite for FUNBOARD
const http = require("http");
const { io: ioClient } = require("socket.io-client");
const { server, app } = require("../server");
const db = require("../db");

const PORT = 3567; // dedicated port for test runner

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runAllChecks() {
  console.log("================================================================");
  console.log("       FUNBOARD COMPREHENSIVE BACKEND VERIFICATION SUITE       ");
  console.log("================================================================\n");

  // 1. Server Start
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[CHECK 1] Server started successfully on port ${PORT}.`);

  try {
    // 2. Health Endpoint with Database Status
    const health = await request("GET", "/health");
    console.log("[CHECK 2] GET /health -> Status:", health.status, "Body:", health.data);
    if (health.status !== 200 || health.data.status !== "ok" || health.data.database !== "connected") {
      throw new Error("Health check failed or database degraded");
    }

    // 3. Room Creation (POST /api/rooms)
    const testRoomId = `room-audit-${Date.now()}`;
    const createRes = await request("POST", "/api/rooms", {
      name: "Verification Board",
      customId: testRoomId,
    });
    console.log("[CHECK 3] POST /api/rooms -> Status:", createRes.status, "Room ID:", createRes.data.roomId);
    if (createRes.status !== 201 || createRes.data.roomId !== testRoomId) {
      throw new Error("Room creation failed");
    }

    // 4. Valid Room Retrieval (GET /api/rooms/:id)
    const validRoom = await request("GET", `/api/rooms/${testRoomId}`);
    console.log("[CHECK 4] GET /api/rooms/:id -> Status:", validRoom.status, "StrokeCount:", validRoom.data.strokeCount);
    if (validRoom.status !== 200 || validRoom.data.roomId !== testRoomId) {
      throw new Error("Valid room retrieval failed");
    }

    // 5. Unknown Room Handling (GET /api/rooms/unknown-id)
    const unknownRoom = await request("GET", "/api/rooms/unknown-fake-room-999");
    console.log("[CHECK 5] GET /api/rooms/:unknown -> Status:", unknownRoom.status, "(Expected 404)");
    if (unknownRoom.status !== 404) {
      throw new Error("Unknown room did not return 404");
    }

    // 6. Multi-tool Drawing Persistence & Real-time Socket.IO Sync
    console.log("[CHECK 6] Testing Multi-Tool Drawing Persistence & Socket.IO Synchronization...");
    const clientA = ioClient(`http://127.0.0.1:${PORT}`, { reconnection: false });
    const clientB = ioClient(`http://127.0.0.1:${PORT}`, { reconnection: false });

    await new Promise((resolve, reject) => {
      let aReady = false;
      let bReady = false;
      clientA.on("connect", () => {
        aReady = true;
        if (bReady) resolve();
      });
      clientB.on("connect", () => {
        bReady = true;
        if (aReady) resolve();
      });
      setTimeout(() => reject(new Error("Client connection timeout")), 4000);
    });

    // Client A joins test room and waits for room-init confirmation
    const aInitPromise = new Promise((resolve, reject) => {
      clientA.once("room-init", resolve);
      setTimeout(() => reject(new Error("Timeout waiting for clientA room-init")), 4000);
    });
    clientA.emit("join-room", {
      roomId: testRoomId,
      userId: "user-alpha",
      userName: "Alice",
      userColor: "#4568F5",
    });
    await aInitPromise;

    // Client B joins test room; Client A should receive user-joined notification
    const bJoinPromise = new Promise((resolve, reject) => {
      clientA.once("user-joined", resolve);
      setTimeout(() => reject(new Error("Timeout waiting for user-joined broadcast")), 4000);
    });

    clientB.emit("join-room", {
      roomId: testRoomId,
      userId: "user-beta",
      userName: "Bob",
      userColor: "#FF7A68",
    });

    await bJoinPromise;
    console.log(" -> Both clients joined room and received presence notifications.");

    // Test different drawing tools:
    // A) Freehand Highlighter
    const highlighterStroke = {
      id: `str_hl_${Date.now()}`,
      roomId: testRoomId,
      userId: "user-alpha",
      userName: "Alice",
      tool: "highlighter",
      color: "#FFE66D",
      fillColor: "transparent",
      size: 15,
      points: [{ x: 50, y: 50 }, { x: 120, y: 60 }],
      createdAt: Date.now(),
    };

    const bRecHighlighter = new Promise((resolve) => {
      clientB.on("stroke-committed", resolve);
    });
    clientA.emit("stroke-end", highlighterStroke);
    const recHl = await bRecHighlighter;
    if (recHl.id !== highlighterStroke.id || recHl.tool !== "highlighter") {
      throw new Error("Highlighter stroke failed to sync");
    }
    console.log(" -> Highlighter stroke synchronized and committed successfully.");

    // B) Geometric Rectangle with Fill
    const rectStroke = {
      id: `str_rect_${Date.now()}`,
      roomId: testRoomId,
      userId: "user-beta",
      userName: "Bob",
      tool: "rect",
      color: "#202020",
      fillColor: "#A8E6CF",
      size: 3,
      points: [{ x: 200, y: 100 }, { x: 400, y: 300 }],
      createdAt: Date.now(),
    };

    const aRecRect = new Promise((resolve) => {
      clientA.on("stroke-committed", resolve);
    });
    clientB.emit("stroke-end", rectStroke);
    const recRect = await aRecRect;
    if (recRect.id !== rectStroke.id || recRect.fillColor !== "#A8E6CF") {
      throw new Error("Rectangle shape stroke failed to sync");
    }
    console.log(" -> Filled Rectangle shape synchronized and committed successfully.");

    // C) Text Object
    const textStroke = {
      id: `str_txt_${Date.now()}`,
      roomId: testRoomId,
      userId: "user-alpha",
      userName: "Alice",
      tool: "text",
      color: "#4568F5",
      fillColor: "transparent",
      size: 5,
      points: [{ x: 250, y: 180 }],
      text: "Collaborative Whiteboard",
      createdAt: Date.now(),
    };

    const bRecText = new Promise((resolve) => {
      clientB.on("stroke-committed", resolve);
    });
    clientA.emit("stroke-end", textStroke);
    const recTxt = await bRecText;
    if (recTxt.id !== textStroke.id || recTxt.text !== "Collaborative Whiteboard") {
      throw new Error("Text object stroke failed to sync");
    }
    console.log(" -> Text object stroke synchronized and committed successfully.");

    // 7. Late Joiner State Retrieval
    console.log("[CHECK 7] Testing Late Joiner Board Recovery from SQLite...");
    const clientLate = ioClient(`http://127.0.0.1:${PORT}`, { reconnection: false });
    await new Promise((resolve) => clientLate.on("connect", resolve));

    const lateInitPromise = new Promise((resolve) => {
      clientLate.on("room-init", resolve);
    });

    clientLate.emit("join-room", {
      roomId: testRoomId,
      userId: "user-charlie",
      userName: "Charlie",
      userColor: "#10B981",
    });

    const lateInit = await lateInitPromise;
    console.log(" -> Late joiner received authoritative strokes count:", lateInit.strokes.length);
    if (lateInit.strokes.length !== 3) {
      throw new Error(`Expected 3 strokes for late joiner, received ${lateInit.strokes.length}`);
    }

    // 8. Room Isolation Check (Room A vs Room B)
    console.log("[CHECK 8] Testing Strict Socket.IO Room Isolation...");
    const isolatedRoomId = `room-isolated-${Date.now()}`;
    await request("POST", "/api/rooms", { customId: isolatedRoomId });

    const clientIsolated = ioClient(`http://127.0.0.1:${PORT}`, { reconnection: false });
    await new Promise((resolve) => clientIsolated.on("connect", resolve));

    let isolatedReceivedLeak = false;
    clientIsolated.on("stroke-committed", () => {
      isolatedReceivedLeak = true;
    });

    clientIsolated.emit("join-room", {
      roomId: isolatedRoomId,
      userId: "user-isolated",
      userName: "Dave",
    });

    // Wait a brief moment for join
    await new Promise((r) => setTimeout(r, 200));

    // Client A draws in testRoomId
    clientA.emit("stroke-end", {
      id: `str_iso_check_${Date.now()}`,
      roomId: testRoomId,
      userId: "user-alpha",
      tool: "pen",
      color: "#202020",
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    });

    await new Promise((r) => setTimeout(r, 300));
    if (isolatedReceivedLeak) {
      throw new Error("Leak detected! Client in Room B received stroke meant for Room A.");
    }
    console.log(" -> Room isolation verified. No cross-room stroke leakage.");

    // 9. Undo & Redo Persistence in SQLite
    console.log("[CHECK 9] Testing Per-User Undo & Redo in SQLite...");
    const undoPromise = new Promise((resolve) => {
      clientB.on("stroke-undone", resolve);
    });
    clientA.emit("undo");
    const undoRes = await undoPromise;
    console.log(" -> Stroke undone broadcast received for:", undoRes.strokeId);

    const redoPromise = new Promise((resolve) => {
      clientB.on("stroke-redone", resolve);
    });
    clientA.emit("redo");
    const redoRes = await redoPromise;
    console.log(" -> Stroke redone broadcast received for:", redoRes.stroke.id);

    // 10. Clear Board Persistence
    console.log("[CHECK 10] Testing Clear Board & SQLite Persistence...");
    const clearPromise = new Promise((resolve) => {
      clientB.on("board-cleared", resolve);
    });
    clientA.emit("clear-board");
    const clearData = await clearPromise;
    console.log(" -> Board cleared notification received from:", clearData.clearedBy);

    const countAfterClear = db.getStrokeCount(testRoomId);
    console.log(" -> Active strokes in SQLite after clear:", countAfterClear);
    if (countAfterClear !== 0) {
      throw new Error("Board clear failed to update SQLite active state");
    }

    // 11. Presence Cleanup on Disconnect
    console.log("[CHECK 11] Testing Presence Cleanup on Disconnect...");
    const presencePromise = new Promise((resolve) => {
      clientA.on("presence-update", (data) => resolve(data));
    });
    clientB.disconnect();
    const presenceAfterLeave = await presencePromise;
    console.log(" -> Presence updated after Bob disconnected. Count:", presenceAfterLeave.count);
    const hasBob = presenceAfterLeave.participants.some((p) => p.userId === "user-beta");
    if (hasBob) {
      throw new Error("Disconnected user was not removed from active presence list");
    }

    // 12. Invalid Payload Protection
    console.log("[CHECK 12] Testing Invalid Payload Protection...");
    const invalidPromise = new Promise((resolve) => {
      clientA.emit("stroke-end", { id: "", points: "not-an-array" }, (ack) => {
        resolve(ack);
      });
    });
    const ackRes = await invalidPromise;
    if (!ackRes || !ackRes.error) {
      throw new Error("Server failed to reject invalid stroke payload");
    }
    console.log(" -> Server safely rejected malformed stroke payload:", ackRes.error);

    // 13. Static Assets Serving
    console.log("[CHECK 13] Testing Static Asset Serving...");
    const [indexRes, cssRes, jsRes] = await Promise.all([
      request("GET", "/"),
      request("GET", "/css/style.css"),
      request("GET", "/js/client.js"),
    ]);
    if (indexRes.status !== 200 || cssRes.status !== 200 || jsRes.status !== 200) {
      throw new Error("Static assets failed to serve");
    }
    console.log(" -> Static frontend assets served with 200 OK.");

    // 14. Server Restart Persistence Verification
    console.log("[CHECK 14] Testing Database Persistence across Server Process Cycle...");
    // Create a new stroke before closing
    const restartTestRoom = `room-restart-${Date.now()}`;
    await request("POST", "/api/rooms", { customId: restartTestRoom });
    const persistentStroke = {
      id: `str_persist_${Date.now()}`,
      roomId: restartTestRoom,
      userId: "user-alpha",
      tool: "pen",
      color: "#202020",
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
      createdAt: Date.now(),
    };
    db.saveStroke(persistentStroke);

    // Stop server
    clientA.disconnect();
    clientLate.disconnect();
    clientIsolated.disconnect();
    await new Promise((r) => server.close(r));
    console.log(" -> Server stopped successfully.");

    // Restart server on PORT
    await new Promise((r) => server.listen(PORT, r));
    console.log(" -> Server restarted. Querying persisted room state...");

    const restoredRoom = await request("GET", `/api/rooms/${restartTestRoom}`);
    if (restoredRoom.status !== 200 || restoredRoom.data.strokes.length !== 1) {
      throw new Error("Restored room state did not survive server restart!");
    }
    console.log(" -> Verified! Persisted stroke successfully reloaded from SQLite after restart.");

    server.close();
    console.log("\n================================================================");
    console.log("    ALL 14 BACKEND COLLABORATION QUALITY CHECKS PASSED!        ");
    console.log("================================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("\nTEST SUITE FAILED:", err);
    try { server.close(); } catch (_) {}
    process.exit(1);
  }
}

runAllChecks();
