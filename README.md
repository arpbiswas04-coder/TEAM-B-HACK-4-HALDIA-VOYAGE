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

Pick **ONE** stack and delete the other, or keep both if you want. Both expose the same endpoints:

| Method | Path | What it should do |
|---|---|---|
| `GET` | `/health` | Already working |
| `POST` | `/api/rooms` | Create a room -> {roomId} |
| `GET` | `/api/rooms/:id` | Get the current board state |

All the endpoints above return `501 Not Implemented` until you build them. Add more endpoints if you need.

## Run locally

**Python**
```bash
pip install -r requirements.txt
python app.py        # http://localhost:5000
```

**Node**
```bash
npm install
npm start            # http://localhost:3000
```

Put secrets in a `.env` file. **Never commit API keys.**

## Deploy (required)

Your project must be live on a public URL. Easiest options:
- **Render**: Web Service, connect the repo. Python start command: `gunicorn app:app`. Node: `npm start`.
- Vercel / Railway / Fly.io also fine.

Add the live URL at the top of your PR description.

## Submit

1. Create a branch: `git checkout -b team-b-solution`
2. Commit and push your work.
3. Open a **Pull Request** against `main` of **this** repository.
4. PR description must include: live URL, what you built, tech used, team members.
5. Also submit on the official **MLH platform (OrganizerHQ)**. Instructions will be given at the start of the event.

## Rules

- Teams of 3 to 4. Every member must be present.
- 3 hours total. Commit often.
- AI tools are open. You must still understand and be able to explain your code.

## Judging

Working demo (35%) | Technical depth (25%) | Completeness of core features (20%) | Deployment (10%) | Presentation (10%)

Good luck, build something great!
