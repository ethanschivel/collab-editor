import http from 'http';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import { checkPassword, hashPassword, requireAuth, signToken, verifyToken } from './auth.js';
import { createSyncServer, CLOSE_NOT_FOUND, CLOSE_UNAUTHORIZED } from './sync.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// "Team Notes!" -> "team-notes-3f9a1c"
export function makeSlug(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = crypto.randomBytes(3).toString('hex');
  return base ? `${base}-${suffix}` : suffix;
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

// Wraps async route handlers so errors reach Express's error handler.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * Builds the HTTP + WebSocket server. Nothing is listening until you call
 * server.listen(), which keeps this easy to start on a random port in tests.
 */
export function createServer({ pool, jwtSecret, saveDelayMs }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const auth = requireAuth(jwtSecret);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // --- accounts -------------------------------------------------------------

  app.post('/api/register', wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }
    if (await db.findUserByEmail(pool, email)) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const user = await db.createUser(pool, { email, name, passwordHash: await hashPassword(password) });
    res.status(201).json({ token: signToken(user, jwtSecret), user: publicUser(user) });
  }));

  app.post('/api/login', wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await db.findUserByEmail(pool, email);
    // Same message either way, so the API doesn't reveal which emails exist.
    if (!user || !(await checkPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    res.json({ token: signToken(user, jwtSecret), user: publicUser(user) });
  }));

  app.get('/api/me', auth, wrap(async (req, res) => {
    const user = await db.findUserById(pool, req.userId);
    if (!user) return res.status(401).json({ error: 'Please log in' });
    res.json({ user });
  }));

  // --- rooms ----------------------------------------------------------------

  app.get('/api/rooms', auth, wrap(async (req, res) => {
    res.json({ rooms: await db.listRooms(pool) });
  }));

  app.post('/api/rooms', auth, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Room name is required' });
    if (name.length > 80) return res.status(400).json({ error: 'Room name is too long' });
    const room = await db.createRoom(pool, { slug: makeSlug(name), name, ownerId: req.userId });
    res.status(201).json({ room });
  }));

  app.get('/api/rooms/:slug', auth, wrap(async (req, res) => {
    const room = await db.findRoomBySlug(pool, req.params.slug);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room });
  }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  // --- real-time sync -------------------------------------------------------

  const sync = createSyncServer({
    load: (roomId) => db.loadDocument(pool, roomId),
    save: (roomId, state) => db.saveDocument(pool, roomId, state),
    saveDelayMs,
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Clients connect to ws://host/<room-slug>?token=<jwt>
  wss.on('connection', (conn, req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const slug = decodeURIComponent(url.pathname.slice(1));

    if (!verifyToken(url.searchParams.get('token'), jwtSecret)) {
      return conn.close(CLOSE_UNAUTHORIZED, 'Please log in');
    }

    const roomId = db.findRoomBySlug(pool, slug).then(
      (room) => {
        if (!room) conn.close(CLOSE_NOT_FOUND, 'Room not found');
        return room ? room.id : null;
      },
      (err) => {
        console.error(err);
        conn.close(1011, 'Server error');
        return null;
      }
    );
    sync.handleConnection(conn, roomId);
  });

  // Shut down without losing edits: close every connection cleanly (so
  // messages already on the wire are still processed), then save.
  async function close() {
    const closed = [...wss.clients].map(
      (client) =>
        new Promise((resolve) => {
          client.once('close', resolve);
          client.close(1001, 'Server shutting down');
          setTimeout(() => {
            client.terminate();
            resolve();
          }, 2000).unref();
        })
    );
    await Promise.all(closed);
    await sync.flushAll();
    await new Promise((resolve) => server.close(resolve));
  }

  return { app, server, close };
}
