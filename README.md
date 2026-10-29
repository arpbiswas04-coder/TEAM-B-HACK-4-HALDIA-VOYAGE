# FUNBOARD — Live Collaborative Whiteboard

> Real-time collaborative drawing rooms with Neo-Brutalist design. Built for **Hack4Haldia'26**.

## Overview

FUNBOARD is an expressive, Neo-Brutalist real-time collaborative whiteboard. Multiple users can join a room and see each other's strokes, shapes, and cursors instantly.

## Architecture

```text
TEAM-B/
├── frontend/
│   ├── index.html          # Neo-Brutalist Homepage & Collaborative Workspace
│   ├── css/
│   │   └── style.css       # Neo-Brutalist design system (borders, hard shadows, palettes)
│   └── js/
│       └── client.js       # Real-time canvas engine (shapes, highlighters, text, cursors)
├── backend/
│   ├── server.js           # Express + Socket.IO real-time server
│   ├── db.js               # SQLite persistence layer (WAL mode, per-user undo/redo)
│   └── tests/
│       └── test_server.js  # Automated headless end-to-end test suite
├── data/
│   └── whiteboard.db       # Persistent SQLite database
├── package.json
└── README.md
```

## Features Implemented

### Core Features
- [x] **Neo-Brutalist Homepage & Workspace**: Distinct two-screen experience with room creation and direct join.
- [x] **Real-Time Stroke Synchronization**: Sub-millisecond latency via Socket.IO.
- [x] **Expanded Toolset**: Freehand pen, solid marker, translucent highlighter, dashed pen, eraser.
- [x] **Geometric Shapes**: Rectangles, circles/ellipses, straight lines, and directional arrows.
- [x] **Inline Text Placement**: Click anywhere on canvas to type and place vector text.
- [x] **Fill Mode**: Toggle between hollow/transparent and solid pastel fill.
- [x] **SQLite State Persistence**: Preserves board state across reloads and server restarts.
- [x] **Late-Joiner Board Recovery**: New participants instantly receive the authoritative board state.
- [x] **Per-User Undo / Redo**: Ctrl+Z / Ctrl+Y with user-isolated history stacks.
- [x] **Live Multi-User Cursors**: Real-time position tracking with custom colored name tags.
- [x] **PNG Board Export**: High-resolution PNG export with warm background preserved.
- [x] **Clear Board Confirmation**: Modal confirmation preventing accidental loss.

## REST API Reference

| Method | Path | Description | Response Status |
|---|---|---|---|
| `GET` | `/health` | Server health check with uptime & SQLite database status | `200 OK` |
| `POST` | `/api/rooms` | Create a new room with optional `customId` and `name` | `201 Created` / `400` / `409` |
| `GET` | `/api/rooms/:id` | Fetch authoritative room state and active stroke records | `200 OK` / `404 Not Found` |
| `POST` | `/api/rooms/:id/clear` | Clear all strokes for a room and broadcast `board-cleared` | `200 OK` / `404 Not Found` |

### Health Check Response Example (`GET /health`)
```json
{
  "status": "ok",
  "project": "FUNBOARD: Collaborative Whiteboard",
  "stack": "node",
  "uptime": 3622,
  "database": "connected",
  "timestamp": 1793265203205
}
```

---

## Local Development & Testing

### 1. Prerequisites
- Node.js v18+ (tested on Node v20 LTS)
- npm v9+

### 2. Installation
```bash
npm install
```

### 3. Start Development Server
```bash
npm start
```
The server will start on `http://localhost:3000`.

### 4. Automated Headless Test Suite
Run the comprehensive 14-point headless verification suite (validates health, room isolation, multi-tool sync, late-join recovery, undo/redo, clear board, presence cleanup, and DB persistence):
```bash
npm test
```

---

## Production Deployment on Render

FUNBOARD is engineered as a unified single-service architecture: the Express server serves the responsive Neo-Brutalist frontend, hosts the REST APIs, powers real-time WebSockets via Socket.IO on the same origin, and maintains room persistence via SQLite.

### Render Service Specifications

| Setting | Value |
|---|---|
| **Service Type** | Web Service |
| **Runtime** | `Node` |
| **Branch** | `team-b-solution` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |
| **Auto-Deploy** | Yes |

### Environment Variables

Configure these in the Render Dashboard (**Environment** tab) or via Blueprint:

| Variable | Recommended Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production optimizations |
| `HOST` | `0.0.0.0` | Binds to all network interfaces for container ingress |
| `PORT` | *(Leave unset)* | Render automatically assigns and populates `PORT` |
| `DB_PATH` | `/var/data/whiteboard.db` *(Optional)* | Custom path for SQLite database |

### SQLite Persistence & Storage Architecture

> [!IMPORTANT]
> **Ephemeral Filesystem on Free Tier**: Render's free Web Services run on ephemeral containers. Local disk writes (such as `./data/whiteboard.db`) persist while the container runs, but will reset upon manual redeployments or container sleep cycles.

#### Durable SQLite with Render Persistent Disk (Paid Plan)
To make your whiteboard rooms completely persistent across all restarts and redeployments:
1. In your Render Web Service dashboard, navigate to **Disks** -> **Add Disk**.
2. **Name**: `funboard-data`
3. **Mount Path**: `/var/data`
4. **Size**: `1 GB` (sufficient for tens of thousands of board drawings)
5. Under **Environment**, add:
   ```env
   DB_PATH=/var/data/whiteboard.db
   ```
The backend automatically creates parent directories recursively if they don't exist, safely initializing `whiteboard.db` on the mounted disk.

#### One-Click Render Blueprint (`render.yaml`)
A ready-to-use Render Blueprint is included in the root directory: [`render.yaml`](render.yaml). You can link your GitHub repository directly using Render's **Blueprints** tab for automated provisioning.

---

## Step-by-Step Render Dashboard Guide

1. Log in to [dashboard.render.com](https://dashboard.render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository: `https://github.com/arpbiswas04-coder/TEAM-B-HACK-4-HALDIA-VOYAGE`.
4. Select branch: `team-b-solution`.
5. Fill in the service details:
   - **Name**: `funboard-whiteboard`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Click **Advanced** and set:
   - **Health Check Path**: `/health`
   - **Environment Variables**:
     - `NODE_ENV` = `production`
     - `HOST` = `0.0.0.0`
7. Click **Create Web Service**.
8. Once the build completes and status shows **Live**, copy your public URL (`https://<service-name>.onrender.com`) and open it to verify.

---

## Git Handoff & Submission Commands

To review your changes and push the branch to your GitHub repository:

```bash
# 1. Verify you are on team-b-solution
git status

# 2. Review modified files and additions
git diff

# 3. Stage the verified files
git add backend/ frontend/ index.html package.json render.yaml .env.example README.md .gitignore

# 4. Commit with descriptive summary
git commit -m "feat: polish neo-brutalist header, add health check, and configure render deployment"

# 5. Push to GitHub
git push origin team-b-solution
```

Open a Pull Request from `team-b-solution` into `main` with your live Render URL in the description.

