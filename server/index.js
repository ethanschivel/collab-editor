import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Minimal Yjs sync server, built directly on y-protocols + lib0.
//
// y-websocket ships a ready-made version of this (setupWSConnection), but its
// package.json has never exposed that file to importers under strict Node
// ESM exports (see yjs/y-websocket#73/#76 — an open issue since 2021), so
// `import ... from 'y-websocket/bin/utils.js'` breaks on current Node. This
// is the same sync protocol, just written out explicitly instead of hidden
// inside the library.
// ---------------------------------------------------------------------------

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const docs = new Map();

function getYDoc(roomName) {
  let doc = docs.get(roomName);
  if (!doc) {
    doc = new Y.Doc();
    doc.awareness = new awarenessProtocol.Awareness(doc);
    doc.conns = new Set();
    docs.set(roomName, doc);
  }
  return doc;
}

function send(conn, encoder) {
  if (conn.readyState === conn.OPEN) {
    conn.send(encoding.toUint8Array(encoder));
  }
}

function setupWSConnection(conn, req) {
  const roomName = (req.url || '/').slice(1).split('?')[0] || 'default';
  const doc = getYDoc(roomName);
  doc.conns.add(conn);

  // Step 1: tell the new client what we already have.
  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  send(conn, syncEncoder);

  // Step 2: send current awareness state (who else is online) if any.
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys()))
    );
    send(conn, awarenessEncoder);
  }

  conn.on('message', (message) => {
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
      if (encoding.length(encoder) > 1) send(conn, encoder);
    } else if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        doc.awareness,
        decoding.readVarUint8Array(decoder),
        conn
      );
    }
  });

  // Broadcast any doc change to every other client in the same room.
  const onDocUpdate = (update) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    doc.conns.forEach((c) => {
      if (c !== conn && c.readyState === c.OPEN) c.send(message);
    });
  };
  doc.on('update', onDocUpdate);

  // Broadcast presence/cursor changes the same way.
  const onAwarenessUpdate = ({ added, updated, removed }) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changedClients)
    );
    const message = encoding.toUint8Array(encoder);
    doc.conns.forEach((c) => {
      if (c.readyState === c.OPEN) c.send(message);
    });
  };
  doc.awareness.on('update', onAwarenessUpdate);

  conn.on('close', () => {
    doc.conns.delete(conn);
    doc.off('update', onDocUpdate);
    doc.awareness.off('update', onAwarenessUpdate);
    awarenessProtocol.removeAwarenessStates(doc.awareness, [conn._clientId], null);
  });
}

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// REST API — auth and room metadata. Kept intentionally simple: this is not
// the interesting part of the project. Swap the stubs below for real
// Postgres-backed logic once the real-time sync path is working end to end.
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }
  // TODO: replace with real user lookup + JWT signing once Postgres is wired up
  res.json({ token: `stub-token-for-${email}` });
});

app.get('/api/rooms', (req, res) => {
  // TODO: replace with a real query against a `rooms` table
  res.json({ rooms: ['general', 'scratch'] });
});

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket / Yjs sync server — this is the actual project.
// setupWSConnection handles the CRDT sync protocol for us; we just need to
// hand it the raw WebSocket connection.
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req);
});

const PORT = process.env.PORT || 1234;

server.listen(PORT, () => {
  console.log(`REST API + WebSocket sync listening on http://localhost:${PORT}`);
  console.log(`Connect clients to ws://localhost:${PORT}`);
});
