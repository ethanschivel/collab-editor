import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per room: the full Yjs document, encoded as a binary update.
CREATE TABLE IF NOT EXISTS documents (
  room_id    INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  state      BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export function createPool(connectionString) {
  return new pg.Pool({ connectionString });
}

export async function migrate(pool) {
  await pool.query(SCHEMA);
}

// --- users -----------------------------------------------------------------

export async function createUser(pool, { email, name, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email, name`,
    [email, name, passwordHash]
  );
  return rows[0];
}

export async function findUserByEmail(pool, email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

export async function findUserById(pool, id) {
  const { rows } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// --- rooms -----------------------------------------------------------------

export async function createRoom(pool, { slug, name, ownerId }) {
  const { rows } = await pool.query(
    `INSERT INTO rooms (slug, name, owner_id) VALUES ($1, $2, $3)
     RETURNING id, slug, name, owner_id, created_at`,
    [slug, name, ownerId]
  );
  return rows[0];
}

export async function listRooms(pool) {
  const { rows } = await pool.query(
    `SELECT r.id, r.slug, r.name, r.created_at, u.name AS owner_name,
            d.updated_at AS last_edited_at
       FROM rooms r
       JOIN users u ON u.id = r.owner_id
       LEFT JOIN documents d ON d.room_id = r.id
      ORDER BY COALESCE(d.updated_at, r.created_at) DESC`
  );
  return rows;
}

export async function findRoomBySlug(pool, slug) {
  const { rows } = await pool.query('SELECT * FROM rooms WHERE slug = $1', [slug]);
  return rows[0] || null;
}

// --- documents -------------------------------------------------------------

export async function loadDocument(pool, roomId) {
  const { rows } = await pool.query('SELECT state FROM documents WHERE room_id = $1', [roomId]);
  return rows[0] ? new Uint8Array(rows[0].state) : null;
}

export async function saveDocument(pool, roomId, state) {
  await pool.query(
    `INSERT INTO documents (room_id, state, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (room_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [roomId, Buffer.from(state)]
  );
}
