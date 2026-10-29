// FUNBOARD Neo-Brutalist Collaborative Whiteboard Engine
(function () {
  "use strict";

  // State Management
  const state = {
    currentScreen: "home", // 'home' | 'whiteboard'
    roomId: null,
    userId: localStorage.getItem("fb_user_id") || "usr_" + Math.random().toString(36).slice(2, 8),
    userName: localStorage.getItem("fb_user_name") || "Artist " + Math.floor(100 + Math.random() * 900),
    userColor: localStorage.getItem("fb_user_color") || getRandomColor(),
    tool: "pen", // 'pen' | 'marker' | 'highlighter' | 'dashed' | 'eraser' | 'rect' | 'circle' | 'line' | 'arrow' | 'text'
    color: "#202020",
    fillMode: false, // true = fill with pastel, false = transparent
    size: 5,
    isDrawing: false,
    dragStartPoint: null,
    currentStroke: null,
    committedStrokes: [],
    remoteLiveStrokes: new Map(), // strokeId -> strokeData
    remoteCursors: new Map(), // userId -> DOMElement
    participants: [],
  };

  localStorage.setItem("fb_user_id", state.userId);
  localStorage.setItem("fb_user_name", state.userName);
  localStorage.setItem("fb_user_color", state.userColor);

  function getRandomColor() {
    const colors = ["#4568F5", "#FF7A68", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // DOM Elements - Screens
  const homeView = document.getElementById("homeView");
  const whiteboardView = document.getElementById("whiteboardView");

  // DOM Elements - Homepage
  const homeCreateName = document.getElementById("homeCreateName");
  const btnHomeCreate = document.getElementById("btnHomeCreate");
  const homeJoinInput = document.getElementById("homeJoinInput");
  const btnHomeJoin = document.getElementById("btnHomeJoin");

  // DOM Elements - Whiteboard Header
  const btnLeaveToHome = document.getElementById("btnLeaveToHome");
  const wbRoomId = document.getElementById("wbRoomId");
  const btnCopyRoomId = document.getElementById("btnCopyRoomId");
  const btnCopyRoomLink = document.getElementById("btnCopyRoomLink");
  const wbStatusDot = document.getElementById("wbStatusDot");
  const wbStatusText = document.getElementById("wbStatusText");
  const participantCount = document.getElementById("participantCount");
  const btnPresenceToggle = document.getElementById("btnPresenceToggle");
  const presenceDrawer = document.getElementById("presenceDrawer");
  const participantsList = document.getElementById("participantsList");
  const btnExportPng = document.getElementById("btnExportPng");
  const btnClearBoard = document.getElementById("btnClearBoard");

  // DOM Elements - Canvas Workspace
  const wbWorkspace = document.getElementById("wbWorkspace");
  const mainCanvas = document.getElementById("mainCanvas");
  const previewCanvas = document.getElementById("previewCanvas");
  const cursorOverlay = document.getElementById("cursorOverlay");
  const emptyBoardBanner = document.getElementById("emptyBoardBanner");
  const inlineTextInput = document.getElementById("inlineTextInput");

  const mainCtx = mainCanvas.getContext("2d");
  const previewCtx = previewCanvas.getContext("2d");

  // DOM Elements - Toolbar
  const toolBtns = document.querySelectorAll(".tb-btn[data-tool]");
  const swatchBtns = document.querySelectorAll(".swatch-btn");
  const customColorInput = document.getElementById("customColorInput");
  const btnToggleFill = document.getElementById("btnToggleFill");
  const fillIcon = document.getElementById("fillIcon");
  const fillText = document.getElementById("fillText");
  const sizeBtns = document.querySelectorAll(".size-btn");
  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");

  // DOM Elements - Modals & Toast
  const modalClearBoard = document.getElementById("modalClearBoard");
  const btnCancelClear = document.getElementById("btnCancelClear");
  const btnConfirmClear = document.getElementById("btnConfirmClear");
  const toastShelf = document.getElementById("toastShelf");

  // Socket.IO Initialization
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  // Toast Notification System
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast-brutal toast-${type}`;
    toast.textContent = message;
    toastShelf.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      toast.style.transition = "all 0.15s ease";
      setTimeout(() => toast.remove(), 150);
    }, 3200);
  }

  function updateStatus(status, text) {
    wbStatusDot.className = `wb-status-dot ${status}`;
    wbStatusText.textContent = text;
  }

  function updateEmptyBannerVisibility() {
    if (state.committedStrokes.length === 0) {
      emptyBoardBanner.style.display = "flex";
    } else {
      emptyBoardBanner.style.display = "none";
    }
  }

  // ========================================================================
  // Screen Navigation & Routing
  // ========================================================================

  function showScreen(screen) {
    state.currentScreen = screen;
    if (screen === "home") {
      homeView.style.display = "flex";
      whiteboardView.style.display = "none";
      if (state.roomId) {
        socket.emit("leave-room");
        state.roomId = null;
      }
      const url = new URL(window.location);
      url.searchParams.delete("room");
      window.history.pushState({}, "", url.pathname);
    } else {
      homeView.style.display = "none";
      whiteboardView.style.display = "flex";
      setupCanvases();
    }
  }

  function joinRoom(roomId) {
    state.roomId = roomId;
    wbRoomId.textContent = roomId;
    showScreen("whiteboard");

    const url = new URL(window.location);
    url.searchParams.set("room", roomId);
    window.history.pushState({}, "", url);

    if (socket.connected) {
      emitJoinRoom();
    }
  }

  function emitJoinRoom() {
    updateStatus("connecting", "Connecting...");
    socket.emit("join-room", {
      roomId: state.roomId,
      userId: state.userId,
      userName: state.userName,
      userColor: state.userColor,
    });
  }

  // Check initial URL routing on page load
  async function initRouting() {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl && /^[a-zA-Z0-9_-]{3,64}$/.test(roomFromUrl.trim())) {
      const targetRoomId = roomFromUrl.trim().toLowerCase();
      try {
        const res = await fetch(`/api/rooms/${targetRoomId}`);
        if (res.ok) {
          joinRoom(targetRoomId);
        } else {
          showScreen("home");
          showToast(`Room "${targetRoomId}" does not exist. Please create it first.`, "error");
        }
      } catch {
        showScreen("home");
        showToast("Error checking room status.", "error");
      }
    } else {
      showScreen("home");
    }
  }

  // Homepage Actions
  btnHomeCreate.addEventListener("click", async () => {
    const name = homeCreateName.value.trim();
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to create room", "error");
        return;
      }
      joinRoom(data.roomId);
      showToast(`Room created: ${data.roomId}`, "success");
    } catch (err) {
      showToast("Network error creating room", "error");
    }
  });

  btnHomeJoin.addEventListener("click", async () => {
    const targetRoomId = homeJoinInput.value.trim().toLowerCase();
    if (!targetRoomId || !/^[a-zA-Z0-9_-]{3,64}$/.test(targetRoomId)) {
      showToast("Please enter a valid room ID (e.g. room-7f2a8c)", "error");
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${targetRoomId}`);
      if (!res.ok) {
        showToast("Room does not exist on server", "error");
        return;
      }
      joinRoom(targetRoomId);
      showToast(`Joined room: ${targetRoomId}`, "success");
    } catch (err) {
      showToast("Error verifying room", "error");
    }
  });

  btnLeaveToHome.addEventListener("click", () => {
    showScreen("home");
  });

  // Whiteboard Copy Buttons
  btnCopyRoomId.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.roomId);
      showToast("Room ID copied to clipboard!", "success");
    } catch (_) {
      showToast("Room ID: " + state.roomId, "info");
    }
  });

  btnCopyRoomLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Share link copied to clipboard!", "success");
    } catch (_) {
      showToast("Link: " + window.location.href, "info");
    }
  });

  // ========================================================================
  // Canvas Resolution & High-DPI Engine
  // ========================================================================

  let dpr = window.devicePixelRatio || 1;
  let workspaceRect = { width: 0, height: 0, left: 0, top: 0 };

  function setupCanvases() {
    dpr = window.devicePixelRatio || 1;
    const rect = wbWorkspace.getBoundingClientRect();
    workspaceRect = rect;

    [mainCanvas, previewCanvas].forEach((canvas) => {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    });

    [mainCtx, previewCtx].forEach((ctx) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    });

    renderAllCommittedStrokes();
  }

  window.addEventListener("resize", () => {
    if (state.currentScreen === "whiteboard") {
      setupCanvases();
    }
  });

  // ========================================================================
  // Drawing & Vector Rendering Engine
  // ========================================================================

  function drawStrokeOnContext(ctx, stroke) {
    if (!stroke) return;
    const pts = stroke.points || [];
    const tool = stroke.tool || "pen";
    const color = stroke.color || "#202020";
    const size = stroke.size || 4;
    const fillColor = stroke.fillColor || "transparent";

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = fillColor;

    // Brush-specific styling
    if (tool === "eraser") {
      ctx.strokeStyle = "#FFFDF7"; // Match canvas background
      ctx.lineWidth = size * 2.5;
    } else if (tool === "highlighter") {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = size * 2.5;
    } else if (tool === "dashed") {
      ctx.setLineDash([8, 6]);
    } else if (tool === "marker") {
      ctx.lineWidth = size * 1.5;
    }

    // 1. Shapes (rect, circle, line, arrow)
    if (tool === "rect" && pts.length >= 2) {
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      const x = Math.min(p1.x, p2.x);
      const y = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);

      if (fillColor !== "transparent") {
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeRect(x, y, w, h);
    } else if (tool === "circle" && pts.length >= 2) {
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const rx = Math.abs(p2.x - p1.x) / 2;
      const ry = Math.abs(p2.y - p1.y) / 2;

      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      if (fillColor !== "transparent") {
        ctx.fill();
      }
      ctx.stroke();
    } else if (tool === "line" && pts.length >= 2) {
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else if (tool === "arrow" && pts.length >= 2) {
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Arrowhead calculations
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const headLen = Math.max(12, size * 2.5);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    } else if (tool === "text" && pts.length >= 1 && stroke.text) {
      // 2. Render confirmed Text
      const p = pts[0];
      const fontSize = Math.max(14, size * 3.5);
      ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = "top";
      ctx.fillText(stroke.text, p.x, p.y);
    } else if (pts.length > 0) {
      // 3. Freehand Stroke with Bézier curve smoothing
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);

        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }

        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function renderAllCommittedStrokes() {
    mainCtx.clearRect(0, 0, workspaceRect.width, workspaceRect.height);
    for (const stroke of state.committedStrokes) {
      drawStrokeOnContext(mainCtx, stroke);
    }
    updateEmptyBannerVisibility();
  }

  function renderPreviewLayer() {
    previewCtx.clearRect(0, 0, workspaceRect.width, workspaceRect.height);

    // Render active local in-progress stroke/shape
    if (state.currentStroke) {
      drawStrokeOnContext(previewCtx, state.currentStroke);
    }

    // Render active remote in-progress strokes
    state.remoteLiveStrokes.forEach((remoteStroke) => {
      drawStrokeOnContext(previewCtx, remoteStroke);
    });
  }

  // ========================================================================
  // Pointer Events & Drawing Handlers
  // ========================================================================

  function getCanvasCoords(e) {
    const rect = wbWorkspace.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const pt = getCanvasCoords(e);

    // If Text tool is active: place inline text editor
    if (state.tool === "text") {
      commitPendingText();
      openInlineTextEditor(pt);
      return;
    }

    commitPendingText();
    state.isDrawing = true;
    state.dragStartPoint = pt;

    try {
      mainCanvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    const strokeId = "str_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    const strokeFill = state.fillMode ? (state.color === "#202020" ? "#FFE66D" : state.color) : "transparent";

    state.currentStroke = {
      id: strokeId,
      roomId: state.roomId,
      userId: state.userId,
      userName: state.userName,
      tool: state.tool,
      color: state.color,
      fillColor: strokeFill,
      size: state.size,
      dash: state.tool === "dashed",
      points: [pt],
      createdAt: Date.now(),
    };

    renderPreviewLayer();

    socket.emit("stroke-start", {
      strokeId,
      tool: state.tool,
      color: state.color,
      fillColor: strokeFill,
      size: state.size,
      dash: state.tool === "dashed",
      point: pt,
    });
  }

  let lastCursorBroadcast = 0;

  function handlePointerMove(e) {
    const pt = getCanvasCoords(e);

    // Throttled cursor position broadcast
    const now = Date.now();
    if (now - lastCursorBroadcast > 40) {
      lastCursorBroadcast = now;
      socket.emit("cursor-move", pt);
    }

    if (!state.isDrawing || !state.currentStroke) return;

    const isShape = ["rect", "circle", "line", "arrow"].includes(state.tool);

    if (isShape) {
      // Shapes stretch dynamically from dragStartPoint to current position
      state.currentStroke.points = [state.dragStartPoint, pt];
    } else {
      // Freehand pen/marker/highlighter appends points
      state.currentStroke.points.push(pt);
    }

    renderPreviewLayer();

    socket.emit("stroke-move", {
      strokeId: state.currentStroke.id,
      point: pt,
      isShape,
    });
  }

  function handlePointerUp(e) {
    if (!state.isDrawing || !state.currentStroke) return;
    state.isDrawing = false;

    try {
      mainCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}

    const finishedStroke = state.currentStroke;
    state.currentStroke = null;

    // Commit locally immediately
    state.committedStrokes.push(finishedStroke);
    drawStrokeOnContext(mainCtx, finishedStroke);
    renderPreviewLayer();
    updateEmptyBannerVisibility();

    // Stream finished stroke to server for SQLite storage & room broadcast
    socket.emit("stroke-end", finishedStroke, (res) => {
      if (res && res.error) {
        showToast("Failed to save stroke: " + res.error, "error");
      }
    });
  }

  mainCanvas.addEventListener("pointerdown", handlePointerDown);
  mainCanvas.addEventListener("pointermove", handlePointerMove);
  mainCanvas.addEventListener("pointerup", handlePointerUp);
  mainCanvas.addEventListener("pointercancel", handlePointerUp);

  // ========================================================================
  // Inline Canvas Text Placement Tool
  // ========================================================================

  let pendingTextCoord = null;

  function openInlineTextEditor(coord) {
    pendingTextCoord = coord;
    inlineTextInput.style.left = `${coord.x}px`;
    inlineTextInput.style.top = `${coord.y}px`;
    inlineTextInput.style.display = "block";
    inlineTextInput.value = "";
    inlineTextInput.focus();
  }

  function commitPendingText() {
    if (inlineTextInput.style.display === "none" || !pendingTextCoord) return;
    const textVal = inlineTextInput.value.trim();
    inlineTextInput.style.display = "none";

    if (textVal) {
      const strokeId = "str_txt_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
      const textStroke = {
        id: strokeId,
        roomId: state.roomId,
        userId: state.userId,
        userName: state.userName,
        tool: "text",
        color: state.color,
        fillColor: "transparent",
        size: state.size,
        points: [pendingTextCoord],
        text: textVal,
        createdAt: Date.now(),
      };

      state.committedStrokes.push(textStroke);
      drawStrokeOnContext(mainCtx, textStroke);
      updateEmptyBannerVisibility();

      socket.emit("stroke-end", textStroke);
    }
    pendingTextCoord = null;
  }

  inlineTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitPendingText();
    } else if (e.key === "Escape") {
      inlineTextInput.style.display = "none";
      pendingTextCoord = null;
    }
  });

  // ========================================================================
  // Toolbar Tool & Option Selection
  // ========================================================================

  toolBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      commitPendingText();
      toolBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tool = btn.dataset.tool;
    });
  });

  swatchBtns.forEach((swatch) => {
    swatch.addEventListener("click", () => {
      swatchBtns.forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
      state.color = swatch.dataset.color;
    });
  });

  customColorInput.addEventListener("input", (e) => {
    state.color = e.target.value;
    swatchBtns.forEach((s) => s.classList.remove("active"));
  });

  // Fill Mode Toggle
  btnToggleFill.addEventListener("click", () => {
    state.fillMode = !state.fillMode;
    if (state.fillMode) {
      btnToggleFill.classList.add("active");
      fillIcon.textContent = "🎨";
      fillText.textContent = "Solid Fill";
    } else {
      btnToggleFill.classList.remove("active");
      fillIcon.textContent = "🚫";
      fillText.textContent = "No Fill";
    }
  });

  // Size Presets
  sizeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      sizeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.size = Number(btn.dataset.size);
    });
  });

  // Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      socket.emit("undo");
    } else if (
      (e.ctrlKey || e.metaKey) &&
      (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      socket.emit("redo");
    } else if (e.key.toLowerCase() === "p") {
      selectTool("pen");
    } else if (e.key.toLowerCase() === "e") {
      selectTool("eraser");
    } else if (e.key.toLowerCase() === "r") {
      selectTool("rect");
    } else if (e.key.toLowerCase() === "c") {
      selectTool("circle");
    } else if (e.key.toLowerCase() === "l") {
      selectTool("line");
    } else if (e.key.toLowerCase() === "a") {
      selectTool("arrow");
    } else if (e.key.toLowerCase() === "t") {
      selectTool("text");
    }
  });

  function selectTool(toolName) {
    const target = document.querySelector(`.tb-btn[data-tool="${toolName}"]`);
    if (target) target.click();
  }

  btnUndo.addEventListener("click", () => socket.emit("undo"));
  btnRedo.addEventListener("click", () => socket.emit("redo"));

  // Clear Board Confirmation Modal
  btnClearBoard.addEventListener("click", () => {
    modalClearBoard.classList.add("active");
  });

  btnCancelClear.addEventListener("click", () => {
    modalClearBoard.classList.remove("active");
  });

  btnConfirmClear.addEventListener("click", () => {
    modalClearBoard.classList.remove("active");
    socket.emit("clear-board");
  });

  // Export Board as PNG
  btnExportPng.addEventListener("click", () => {
    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = mainCanvas.width;
      exportCanvas.height = mainCanvas.height;
      const expCtx = exportCanvas.getContext("2d");

      // Draw warm off-white background
      expCtx.fillStyle = "#FFFDF7";
      expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      // Draw all committed strokes
      expCtx.drawImage(mainCanvas, 0, 0);

      const link = document.createElement("a");
      link.download = `funboard-${state.roomId}-${Date.now()}.png`;
      link.href = exportCanvas.toDataURL("image/png");
      link.click();
      showToast("FUNBOARD exported as PNG!", "success");
    } catch (err) {
      console.error("Export failed:", err);
      showToast("Failed to export PNG", "error");
    }
  });

  // ========================================================================
  // Presence & Remote Cursors
  // ========================================================================

  btnPresenceToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    presenceDrawer.classList.toggle("active");
  });

  document.addEventListener("click", (e) => {
    if (!presenceDrawer.contains(e.target) && e.target !== btnPresenceToggle) {
      presenceDrawer.classList.remove("active");
    }
  });

  function updatePresenceUI(participants) {
    state.participants = participants || [];
    participantCount.textContent = `${state.participants.length} online`;
    participantsList.innerHTML = "";

    state.participants.forEach((p) => {
      const row = document.createElement("div");
      row.className = "presence-item";

      const avatar = document.createElement("div");
      avatar.className = "presence-avatar";
      avatar.style.backgroundColor = p.userColor || "#FFE66D";
      avatar.textContent = (p.userName || "U").charAt(0).toUpperCase();

      const name = document.createElement("span");
      name.textContent = p.userName + (p.userId === state.userId ? " (You)" : "");

      row.appendChild(avatar);
      row.appendChild(name);
      participantsList.appendChild(row);
    });
  }

  function updateRemoteCursor(data) {
    if (data.userId === state.userId) return;

    let cursorEl = state.remoteCursors.get(data.userId);
    if (!cursorEl) {
      cursorEl = document.createElement("div");
      cursorEl.className = "remote-cursor-el";
      cursorEl.innerHTML = `
        <svg class="cursor-pointer-svg" viewBox="0 0 24 24" fill="${data.color || "#4568F5"}" stroke="#202020" stroke-width="2">
          <polygon points="0 0, 0 18, 5 13, 11 22, 14 20, 8 12, 16 12" />
        </svg>
        <span class="cursor-user-badge" style="border-left: 3px solid ${data.color || "#4568F5"};">${data.userName || "User"}</span>
      `;
      cursorOverlay.appendChild(cursorEl);
      state.remoteCursors.set(data.userId, cursorEl);
    }

    cursorEl.style.transform = `translate3d(${data.x}px, ${data.y}px, 0)`;
  }

  function removeRemoteCursor(userId) {
    const el = state.remoteCursors.get(userId);
    if (el) {
      el.remove();
      state.remoteCursors.delete(userId);
    }
  }

  // ========================================================================
  // Socket.IO Events
  // ========================================================================

  socket.on("connect", () => {
    updateStatus("online", "Live");
    if (state.roomId) {
      emitJoinRoom();
    }
  });

  socket.on("disconnect", () => {
    updateStatus("offline", "Offline");
  });

  socket.on("connect_error", () => {
    updateStatus("connecting", "Reconnecting...");
  });

  socket.on("room-init", (data) => {
    updateStatus("online", "Live");
    state.committedStrokes = data.strokes || [];
    state.remoteLiveStrokes.clear();
    renderAllCommittedStrokes();
    renderPreviewLayer();
    updatePresenceUI(data.participants);
    showToast(`Loaded ${state.committedStrokes.length} elements for ${data.roomId}`, "info");
  });

  socket.on("presence-update", (data) => {
    updatePresenceUI(data.participants);
  });

  socket.on("user-joined", (data) => {
    showToast(`${data.userName} joined the room`, "info");
  });

  // Live remote stroke / shape preview
  socket.on("remote-stroke-start", (data) => {
    state.remoteLiveStrokes.set(data.strokeId, {
      tool: data.tool,
      color: data.color,
      fillColor: data.fillColor || "transparent",
      size: data.size,
      dash: Boolean(data.dash),
      points: [data.point],
    });
    renderPreviewLayer();
  });

  socket.on("remote-stroke-move", (data) => {
    const stroke = state.remoteLiveStrokes.get(data.strokeId);
    if (stroke) {
      if (data.isShape) {
        stroke.points = [stroke.points[0], data.point];
      } else {
        stroke.points.push(data.point);
      }
      renderPreviewLayer();
    }
  });

  socket.on("stroke-committed", (stroke) => {
    state.remoteLiveStrokes.delete(stroke.id);
    state.committedStrokes.push(stroke);
    drawStrokeOnContext(mainCtx, stroke);
    renderPreviewLayer();
    updateEmptyBannerVisibility();
  });

  socket.on("stroke-undone", (data) => {
    const idx = state.committedStrokes.findIndex((s) => s.id === data.strokeId);
    if (idx !== -1) {
      state.committedStrokes.splice(idx, 1);
      renderAllCommittedStrokes();
    }
  });

  socket.on("stroke-redone", (data) => {
    if (data.stroke) {
      state.committedStrokes.push(data.stroke);
      drawStrokeOnContext(mainCtx, data.stroke);
      updateEmptyBannerVisibility();
    }
  });

  socket.on("board-cleared", (data) => {
    state.committedStrokes = [];
    state.remoteLiveStrokes.clear();
    renderAllCommittedStrokes();
    renderPreviewLayer();
    showToast(`Whiteboard cleared by ${data.clearedBy || "user"}`, "info");
  });

  socket.on("remote-cursor", (data) => {
    updateRemoteCursor(data);
  });

  socket.on("remote-cursor-remove", (data) => {
    removeRemoteCursor(data.userId);
  });

  socket.on("error-msg", (data) => {
    showToast(data.message || "An error occurred", "error");
  });

  socket.on("room-not-found", (data) => {
    showScreen("home");
    showToast(data.message || "Room not found. Please create one first.", "error");
  });

  // Handle browser back/forward buttons
  window.addEventListener("popstate", () => {
    initRouting();
  });

  // Startup initialization
  initRouting();
})();
