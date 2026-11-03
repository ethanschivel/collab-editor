import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';

// ---------------------------------------------------------------------------
// Yjs sync server, built directly on y-protocols + lib0.
//
// y-websocket ships a ready-made version of this (setupWSConnection), but its
// package.json has never exposed that file to importers under strict Node
// ESM exports (see yjs/y-websocket#73/#76), so importing it breaks on current
// Node. This is the same sync protocol, written out explicitly, plus:
//   - loading each room's document from Postgres the first time it is opened
//   - saving it back (debounced) as people type, and once more when the
//     last person leaves, so documents survive server restarts
// ---------------------------------------------------------------------------

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_NOT_FOUND = 4404;

function send(conn, encoder) {
  if (conn.readyState === conn.OPEN) {
    conn.send(encoding.toUint8Array(encoder));
  }
}

/**
 * @param {object} opts
 * @param {(roomId: number) => Promise<Uint8Array|null>} opts.load
 * @param {(roomId: number, state: Uint8Array) => Promise<void>} opts.save
 * @param {number} [opts.saveDelayMs] how long to wait after the last edit before saving
 */
export function createSyncServer({ load, save, saveDelayMs = 1000 }) {
  // roomId -> Promise<Y.Doc>. Storing the promise (not the doc) means two
  // people opening the same room at the same moment share one load.
  const docs = new Map();
  // roomId -> Promise of the final save after everyone left. A room that is
  // reopened waits for this, so it never loads a stale copy.
  const finalSaves = new Map();

  function persist(doc) {
    clearTimeout(doc.saveTimer);
    doc.saveTimer = null;
    return save(doc.roomId, Y.encodeStateAsUpdate(doc)).catch((err) => {
      console.error(`Failed to save room ${doc.roomId}:`, err);
    });
  }

  function getDoc(roomId) {
    let pending = docs.get(roomId);
    if (!pending) {
      pending = (async () => {
        const doc = new Y.Doc();
        doc.roomId = roomId;
        doc.conns = new Set();
        doc.saveTimer = null;
        await finalSaves.get(roomId);
        const saved = await load(roomId);
        if (saved) Y.applyUpdate(doc, saved);
        doc.awareness = new awarenessProtocol.Awareness(doc);
        doc.awareness.setLocalState(null); // the server itself isn't a user
        doc.on('update', () => {
          clearTimeout(doc.saveTimer);
          doc.saveTimer = setTimeout(() => persist(doc), saveDelayMs);
        });
        return doc;
      })();
      pending.catch(() => docs.delete(roomId));
      docs.set(roomId, pending);
    }
    return pending;
  }

  /**
   * Attach a new WebSocket connection to a room.
   * @param conn the WebSocket
   * @param roomIdPromise resolves to the room id, or to null if the caller
   *   rejected the connection (and already closed it)
   */
  async function handleConnection(conn, roomIdPromise) {
    // Messages can arrive while we look up the room and load the document.
    // Hold on to them and replay them once everything is ready.
    const queued = [];
    const queue = (m) => queued.push(m);
    conn.on('message', queue);

    const roomId = await roomIdPromise;
    if (roomId == null) return;

    let doc;
    try {
      doc = await getDoc(roomId);
    } catch (err) {
      console.error(`Failed to load room ${roomId}:`, err);
      conn.close(1011, 'Could not load document');
      return;
    }
    if (conn.readyState !== conn.OPEN) return; // left while we were loading

    doc.conns.add(conn);
    const awarenessIds = new Set(); // awareness client ids owned by this conn

    const onMessage = (message) => {
      try {
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
      } catch (err) {
        console.error('Bad message from client:', err);
      }
    };

    // Broadcast any doc change to every other client in the same room.
    const onDocUpdate = (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      if (origin !== conn && conn.readyState === conn.OPEN) conn.send(message);
    };
    doc.on('update', onDocUpdate);

    // Broadcast presence/cursor changes, and remember which awareness ids
    // belong to this connection so we can clear them when it closes.
    const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === conn) {
        added.forEach((id) => awarenessIds.add(id));
        removed.forEach((id) => awarenessIds.delete(id));
      }
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changed)
      );
      send(conn, encoder);
    };
    doc.awareness.on('update', onAwarenessUpdate);

    conn.on('close', () => {
      doc.conns.delete(conn);
      doc.off('update', onDocUpdate);
      doc.awareness.off('update', onAwarenessUpdate);
      awarenessProtocol.removeAwarenessStates(doc.awareness, [...awarenessIds], null);

      // Last person left: save now and free the memory.
      if (doc.conns.size === 0) {
        docs.delete(roomId);
        const saving = persist(doc).then(() => doc.destroy());
        finalSaves.set(roomId, saving);
        saving.then(() => {
          if (finalSaves.get(roomId) === saving) finalSaves.delete(roomId);
        });
      }
    });

    conn.off('message', queue);
    conn.on('message', onMessage);

    // Step 1: tell the new client what we already have.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    send(conn, syncEncoder);

    // Step 2: send current awareness state (who else is online), if any.
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

    queued.forEach(onMessage);
  }

  // Save every open document. Used on shutdown.
  async function flushAll() {
    const open = await Promise.allSettled(docs.values());
    await Promise.all([
      ...open.filter((r) => r.status === 'fulfilled').map((r) => persist(r.value)),
      ...finalSaves.values(),
    ]);
  }

  return { handleConnection, flushAll };
}
