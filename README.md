# Collab Editor

A real-time collaborative text editor. Open the same document in two browser tabs (or on two computers), and edits show up in both instantly.

Built with **React** and **Yjs** (a CRDT library) on the client, and **Node.js / Express** with a WebSocket sync server on the backend.

> **Status:** in progress. Real-time sync works end to end. Accounts, saved documents and rooms are next (see the roadmap below).

## How it works

```text
 Browser A ──┐                         ┌── Browser B
 React + Yjs │   WebSocket (y-websocket) │ React + Yjs
             └──────►  Node server  ◄────┘
                    Express REST API
                    + Yjs sync server
```

Each client holds a copy of the document as a Yjs CRDT. Edits are sent over a WebSocket and merged automatically, so two people can type at the same time without overwriting each other and without a central lock.

## Tech stack

| Part | Tech |
|---|---|
| Client | React 18, Vite, Yjs, y-websocket |
| Server | Node.js, Express, ws, Yjs |
| Planned | PostgreSQL for users and saved documents |

## Running it locally

Requires Node.js 18 or newer. Use two terminals.

**Server:**

```bash
cd server
npm install
npm run dev
```

The server listens on `http://localhost:1234`.

**Client:**

```bash
cd client
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`) in two tabs and start typing in one.

## Project structure

```text
collab-editor/
├── client/   React app (Vite)
└── server/   Express REST API + WebSocket sync server
```

## Roadmap

- [x] Real-time sync between clients over WebSockets
- [ ] Character-level editor binding (CodeMirror + Yjs) instead of whole-text updates
- [ ] User accounts: hashed passwords and JWT login, stored in PostgreSQL
- [ ] Named rooms, with documents that persist after a server restart
- [ ] Live cursors and presence for other users
- [ ] Tests and GitHub Actions CI
- [ ] Deploy the client and server
