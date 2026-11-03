import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { resetDatabase, setupDatabase, startServer, waitFor } from './helpers.js';

let pool;
let srv;
let token;
let slug;
const providers = [];

before(async () => {
  pool = await setupDatabase();
});

beforeEach(async () => {
  await resetDatabase(pool);
  srv = await startServer(pool);
  const reg = await request(srv.app)
    .post('/api/register')
    .send({ email: 'a@example.com', name: 'A', password: 'password123' });
  token = reg.body.token;
  const room = await request(srv.app)
    .post('/api/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Notes' });
  slug = room.body.room.slug;
});

afterEach(async () => {
  // Destroying the doc also stops its awareness timer, which would
  // otherwise keep the test process alive.
  providers.splice(0).forEach((p) => {
    p.destroy();
    p.doc.destroy();
  });
  await srv.close();
});

after(() => pool.end());

function connect(server = srv) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(server.wsUrl, slug, doc, {
    WebSocketPolyfill: WebSocket,
    params: { token },
    // Clients in the same process would otherwise also sync directly over a
    // BroadcastChannel, skipping the server we are trying to test.
    disableBc: true,
  });
  providers.push(provider);
  return { doc, provider, text: doc.getText('content') };
}

async function connected(client) {
  await waitFor(() => client.provider.synced, { message: 'client to sync' });
}

function closeCode(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on('close', (code) => resolve(code));
  });
}

test('edits sync between two clients in the same room', async () => {
  const a = connect();
  const b = connect();
  await connected(a);
  await connected(b);

  a.text.insert(0, 'hello');
  await waitFor(() => b.text.toString() === 'hello', { message: 'B to see A' });

  b.text.insert(5, ' world');
  await waitFor(() => a.text.toString() === 'hello world', { message: 'A to see B' });

  a.provider.destroy();
  b.provider.destroy();
});

test('concurrent edits merge without losing text', async () => {
  const a = connect();
  const b = connect();
  await connected(a);
  await connected(b);

  // Both type at the same moment, before seeing each other's change.
  a.text.insert(0, 'AAA');
  b.text.insert(0, 'BBB');

  await waitFor(
    () => a.text.length === 6 && a.text.toString() === b.text.toString(),
    { message: 'both clients to converge' }
  );
  assert.ok(a.text.toString().includes('AAA'));
  assert.ok(a.text.toString().includes('BBB'));

  a.provider.destroy();
  b.provider.destroy();
});

test('presence shows who is in the room and clears when they leave', async () => {
  const a = connect();
  const b = connect();
  await connected(a);
  await connected(b);

  b.provider.awareness.setLocalStateField('user', { name: 'Bob' });
  const bobVisible = () =>
    [...a.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Bob');
  await waitFor(bobVisible, { message: 'A to see Bob' });

  // Close B's socket abruptly, without saying goodbye.
  b.provider.shouldConnect = false;
  b.provider.ws.terminate();
  await waitFor(() => !bobVisible(), { message: 'Bob to disappear' });

  a.provider.destroy();
  b.provider.destroy();
});

test('documents are saved and survive a server restart', async () => {
  const a = connect();
  await connected(a);
  a.text.insert(0, 'saved to postgres');
  a.provider.destroy();

  await srv.close(); // saves anything still open

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM documents');
  assert.equal(rows[0].n, 1);

  srv = await startServer(pool);
  const b = connect();
  await connected(b);
  assert.equal(b.text.toString(), 'saved to postgres');
  b.provider.destroy();
});

test('connections without a valid token are rejected', async () => {
  assert.equal(await closeCode(`${srv.wsUrl}/${slug}`), 4401);
  assert.equal(await closeCode(`${srv.wsUrl}/${slug}?token=forged`), 4401);
});

test('connections to unknown rooms are rejected', async () => {
  assert.equal(await closeCode(`${srv.wsUrl}/no-such-room?token=${token}`), 4404);
});
