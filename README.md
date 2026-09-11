# Collab editor (starter)

A minimal real-time collaborative text editor: React + Yjs on the client,
Express + y-websocket on the server. This is week-1 scaffolding — it proves
the sync path works end to end. Persistence, auth, and rooms are stubbed out
for you to build next.

## Project structure

```
collab-editor/
  server/   Express REST API + WebSocket/Yjs sync server
  client/   React app (Vite)
```

## Running it locally

Open two terminals in VS Code (View → Terminal, then split it, or just open
two integrated terminal tabs).

**Terminal 1 — server:**
```bash
cd server
npm install
npm run dev
```
You should see `REST API + WebSocket sync listening on http://localhost:1234`.

**Terminal 2 — client:**
```bash
cd client
npm install
npm run dev
```
Vite will print a local URL, typically `http://localhost:5173`.

Open that URL in **two separate browser tabs**. Type in one — it should
appear in the other within a second. That's the whole demo.

## What's real vs stubbed

- **Real:** the WebSocket + Yjs sync path. This is the actual hard part of
  the project and it's fully wired up.
- **Stubbed:** `/api/login` and `/api/rooms` in `server/index.js` return fake
  data. There's no Postgres connection yet even though `pg` is installed.
- **Naive on purpose:** the textarea binding in `client/src/App.jsx` rewrites
  the whole document on every keystroke instead of sending precise deltas.
  It works for a demo with light typing but will feel janky with two people
  typing in the same spot at once. Upgrading this to a proper binding
  (`y-textarea`, or a CodeMirror/ProseMirror + Yjs binding) is a great next
  milestone — and a good story for an interview about naive-vs-production
  approaches to the same problem.

## Suggested next steps (roughly in order)

1. Get the demo above running and confirm two tabs sync.
2. Swap the naive textarea binding for `y-textarea` or a CodeMirror binding.
3. Add real auth: hash passwords, sign real JWTs, store users in Postgres.
4. Add real rooms: let users create/join named documents, store metadata in
   Postgres, and load/save Yjs document snapshots so content persists across
   server restarts (see `y-websocket`'s persistence docs for a Postgres-
   backed `y-leveldb`/custom persistence adapter).
5. Add presence: show other users' cursors using `provider.awareness` (the
   awareness API is already connected — see the `peers` count in `App.jsx`
   for a starting point).
6. Write a few unit tests around the Yjs document logic, then set up a
   GitHub Actions workflow to run them on push.
7. Deploy: client to Vercel/Netlify, server to Railway/Fly.io with a managed
   Postgres instance.
