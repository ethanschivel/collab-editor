# Collab Editor

![ci](https://github.com/ethanschivel/collab-editor/actions/workflows/ci.yml/badge.svg)

A real-time collaborative text editor. Create a document, share the link, and everyone in it can type at the same time. Each person's cursor shows up live, and documents are saved automatically.

**Live demo: [collab-editor-xrgv.onrender.com](https://collab-editor-xrgv.onrender.com)** (free hosting, so the first visit can take up to a minute to wake the server up)

Built with **React**, **CodeMirror 6** and **Yjs** (a CRDT library) on the client, and **Node.js / Express**, **WebSockets** and **PostgreSQL** on the server.

## Features

- **Live collaborative editing:** edits sync character by character over WebSockets, and simultaneous typing merges cleanly without locks.
- **Live cursors and presence:** see where everyone else's cursor is, with their name and color, plus who is in the document right now.
- **Accounts:** sign up and log in with bcrypt-hashed passwords and JWT sessions.
- **Documents (rooms):** create named documents and share them by link.
- **Autosave:** documents are saved to Postgres as you type, when the last person leaves, and on server shutdown, so nothing is lost on restart.
- **Per-user undo:** Ctrl/Cmd+Z undoes your own changes, not other people's.
- **Markdown highlighting**, light and dark themes, and a layout that works on phones.

## How it works

```text
 Browser A ─────┐                       ┌───── Browser B
 React          │                       │          React
 CodeMirror+Yjs │  WebSocket (Yjs sync) │ CodeMirror+Yjs
                └──►   Node server   ◄──┘
                     Express REST API
                     Yjs sync server
                           │
                       PostgreSQL
              users · rooms · document snapshots
```

1. Each browser keeps its own copy of the document as a **Yjs CRDT**. Typing produces small updates that are sent over a WebSocket.
2. The server applies each update to its in-memory copy of the room and forwards it to everyone else in the room. Because CRDT updates merge in any order, two people typing at the same spot never overwrite each other.
3. The first time a room is opened, the server loads its saved snapshot from Postgres. As people type, it saves a fresh snapshot (debounced to once per second), and it saves again when the last person leaves.
4. Cursor positions and names travel over the same connection using the Yjs **awareness** protocol, and are cleared as soon as someone's connection drops.
5. WebSocket connections must carry a valid JWT and point at an existing room. Otherwise the server closes them with code `4401` or `4404`.

The sync server is written directly on `y-protocols` rather than using `y-websocket`'s bundled server, which can't be imported under Node's strict ESM rules. See [server/src/sync.js](server/src/sync.js).

## Tech stack

| Part | Tech |
|---|---|
| Client | React 18, React Router, CodeMirror 6, Yjs, y-codemirror.next, y-websocket, Vite |
| Server | Node.js, Express, ws, Yjs / y-protocols, bcryptjs, jsonwebtoken |
| Database | PostgreSQL |
| Testing | node:test, supertest, GitHub Actions with a Postgres service |

## Running it locally

You need **Node.js 20+** and **PostgreSQL** running locally (on a Mac, [Postgres.app](https://postgresapp.com) is the easiest way).

**1. Create the database**

```bash
createdb collab_editor
```

**2. Start the server**

```bash
cd server
cp .env.example .env    # then set JWT_SECRET to a long random string
npm install
npm run dev
```

It creates its tables automatically and listens on `http://localhost:1234`.

**3. Start the client** (in a second terminal)

```bash
cd client
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`), create an account and a document, then open the same document in a second window (a private window lets you log in as a different person) and type in both.

## Tests

The server has integration tests that start the real server on a random port and connect real Yjs clients to it. They check that:

- edits sync between clients, and simultaneous edits merge without losing text
- presence updates, and is cleared when a connection drops
- documents survive a server restart
- connections without a valid token, or to unknown rooms, are rejected
- registration, login, password hashing and room endpoints behave correctly

```bash
createdb collab_editor_test
cd server
npm test
```

Set `TEST_DATABASE_URL` if your Postgres isn't at `postgres://postgres@localhost:5432/collab_editor_test`. GitHub Actions runs the tests against Postgres 16 and builds the client on every push.

## Deploying

In production one Node server hosts both the API and the built React app, so it deploys as a single service with a Postgres database (for example on Railway, Render or Fly.io).

**Render (one click):** the repo includes a [`render.yaml`](render.yaml) Blueprint. In Render, choose **New → Blueprint**, pick this repo, and it creates the web service and database and generates `JWT_SECRET` for you.

**Anywhere else:**

```bash
npm run build   # installs everything and builds the client
npm start       # starts the server, which also serves client/dist
```

Set these environment variables on the host:

| Variable | Example |
|---|---|
| `DATABASE_URL` | `postgres://user:password@host:5432/collab_editor` |
| `JWT_SECRET` | output of `openssl rand -hex 32` |
| `PORT` | usually set by the host |

## Project structure

```text
collab-editor/
├── client/
│   └── src/
│       ├── pages/          Login, document list, editor page
│       ├── components/     CodeMirror + Yjs editor
│       ├── api.js          REST client and token storage
│       └── auth.jsx        Login state (React context)
└── server/
    ├── index.js            Entry point: config, migrations, graceful shutdown
    ├── src/
    │   ├── app.js          Express routes and WebSocket auth
    │   ├── sync.js         Yjs sync protocol, presence, persistence
    │   ├── auth.js         Password hashing, JWTs, auth middleware
    │   └── db.js           Schema and queries
    └── test/               API and real-time sync integration tests
```

## Ideas for later

- Document permissions (private documents, invite-only sharing)
- Version history, using Yjs snapshots
- Rename and delete documents
- Rate limiting on login and sign-up
