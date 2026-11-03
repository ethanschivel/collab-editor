import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createPool, migrate } from './src/db.js';
import { createServer } from './src/app.js';

dotenv.config();

const { DATABASE_URL, JWT_SECRET } = process.env;
const PORT = process.env.PORT || 1234;

if (!DATABASE_URL || !JWT_SECRET) {
  console.error('Missing DATABASE_URL or JWT_SECRET. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const pool = createPool(DATABASE_URL);
await migrate(pool);

// If the client has been built (npm run build in client/), serve it too.
const builtClient = fileURLToPath(new URL('../client/dist', import.meta.url));
const clientDir = fs.existsSync(builtClient) ? builtClient : undefined;

const { server, close } = createServer({ pool, jwtSecret: JWT_SECRET, clientDir });

server.listen(PORT, () => {
  console.log(`API + real-time sync listening on http://localhost:${PORT}`);
});

// Save open documents before exiting (Ctrl+C, or a host restarting us).
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Saving open documents...');
  await close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
