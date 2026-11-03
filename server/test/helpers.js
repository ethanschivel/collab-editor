import { createPool, migrate } from '../src/db.js';
import { createServer } from '../src/app.js';

export const JWT_SECRET = 'test-secret';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/collab_editor_test';

export async function setupDatabase() {
  const pool = createPool(TEST_DATABASE_URL);
  await migrate(pool);
  return pool;
}

export async function resetDatabase(pool) {
  await pool.query('TRUNCATE users, rooms, documents RESTART IDENTITY CASCADE');
}

// Starts a server on a random free port.
export async function startServer(pool, opts = {}) {
  const instance = createServer({ pool, jwtSecret: JWT_SECRET, saveDelayMs: 50, ...opts });
  await new Promise((resolve) => instance.server.listen(0, resolve));
  const { port } = instance.server.address();
  return { ...instance, port, wsUrl: `ws://localhost:${port}` };
}

// Polls until check() returns true, or fails after `timeout` ms.
export async function waitFor(check, { timeout = 3000, message = 'condition' } = {}) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
