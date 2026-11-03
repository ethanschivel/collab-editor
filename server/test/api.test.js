import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeSlug } from '../src/app.js';
import { resetDatabase, setupDatabase, startServer } from './helpers.js';

let pool;
let srv;

before(async () => {
  pool = await setupDatabase();
  srv = await startServer(pool);
});
beforeEach(() => resetDatabase(pool));
after(async () => {
  await srv.close();
  await pool.end();
});

const alice = { email: 'alice@example.com', name: 'Alice', password: 'correct-horse' };

async function register(user = alice) {
  const res = await request(srv.app).post('/api/register').send(user);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe('accounts', () => {
  test('register returns a token and the user, without the password', async () => {
    const body = await register();
    assert.ok(body.token);
    assert.deepEqual(body.user, { id: 1, email: alice.email, name: 'Alice' });
  });

  test('passwords are stored hashed', async () => {
    await register();
    const { rows } = await pool.query('SELECT password_hash FROM users');
    assert.notEqual(rows[0].password_hash, alice.password);
    assert.match(rows[0].password_hash, /^\$2[aby]\$/);
  });

  test('emails are case-insensitive and must be unique', async () => {
    await register();
    const res = await request(srv.app)
      .post('/api/register')
      .send({ ...alice, email: 'ALICE@example.com' });
    assert.equal(res.status, 409);
  });

  test('register rejects bad input', async () => {
    const cases = [
      { ...alice, email: 'not-an-email' },
      { ...alice, name: '   ' },
      { ...alice, password: 'short' },
    ];
    for (const body of cases) {
      const res = await request(srv.app).post('/api/register').send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test('login works with the right password only', async () => {
    await register();
    const ok = await request(srv.app)
      .post('/api/login')
      .send({ email: alice.email, password: alice.password });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);

    const wrong = await request(srv.app)
      .post('/api/login')
      .send({ email: alice.email, password: 'wrong-password' });
    assert.equal(wrong.status, 401);

    const unknown = await request(srv.app)
      .post('/api/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, wrong.body.error);
  });

  test('/api/me needs a valid token', async () => {
    const { token } = await register();
    const me = await request(srv.app).get('/api/me').set('Authorization', `Bearer ${token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, alice.email);

    const noToken = await request(srv.app).get('/api/me');
    assert.equal(noToken.status, 401);
    const badToken = await request(srv.app).get('/api/me').set('Authorization', 'Bearer nope');
    assert.equal(badToken.status, 401);
  });
});

describe('rooms', () => {
  test('rooms need login', async () => {
    assert.equal((await request(srv.app).get('/api/rooms')).status, 401);
    assert.equal((await request(srv.app).post('/api/rooms').send({ name: 'x' })).status, 401);
  });

  test('create, list and fetch a room', async () => {
    const { token } = await register();
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(srv.app).post('/api/rooms').set(auth).send({ name: 'Team Notes' });
    assert.equal(created.status, 201);
    assert.match(created.body.room.slug, /^team-notes-[0-9a-f]{6}$/);

    const list = await request(srv.app).get('/api/rooms').set(auth);
    assert.equal(list.body.rooms.length, 1);
    assert.equal(list.body.rooms[0].name, 'Team Notes');
    assert.equal(list.body.rooms[0].owner_name, 'Alice');

    const one = await request(srv.app).get(`/api/rooms/${created.body.room.slug}`).set(auth);
    assert.equal(one.status, 200);
    const missing = await request(srv.app).get('/api/rooms/does-not-exist').set(auth);
    assert.equal(missing.status, 404);
  });

  test('room names are required', async () => {
    const { token } = await register();
    const res = await request(srv.app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  ' });
    assert.equal(res.status, 400);
  });
});

test('makeSlug builds URL-safe, unique slugs', () => {
  assert.match(makeSlug('Hello, World!'), /^hello-world-[0-9a-f]{6}$/);
  assert.match(makeSlug('!!!'), /^[0-9a-f]{6}$/);
  assert.notEqual(makeSlug('same'), makeSlug('same'));
});
