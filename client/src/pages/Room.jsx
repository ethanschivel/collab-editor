import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { api, getToken, WS_URL } from '../api.js';
import { useAuth } from '../auth.jsx';
import { colorFor } from '../colors.js';
import Editor from '../components/Editor.jsx';

// Close codes the server uses to reject a connection (see server/src/sync.js).
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_FOUND = 4404;

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Offline, reconnecting…',
};

export default function Room() {
  const { slug } = useParams();
  const { user, logout } = useAuth();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null); // { ytext, awareness }
  const [status, setStatus] = useState('connecting');
  const [synced, setSynced] = useState(false);
  const [people, setPeople] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRoom(null);
    setError('');
    api
      .getRoom(slug)
      .then(({ room }) => setRoom(room))
      .catch((err) => setError(err.status === 404 ? 'This document does not exist.' : err.message));
  }, [slug]);

  useEffect(() => {
    if (!room) return;

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, room.slug, ydoc, {
      params: { token: getToken() },
    });
    const color = colorFor(user.id);
    provider.awareness.setLocalStateField('user', {
      id: user.id,
      name: user.name,
      color,
      colorLight: `${color}33`,
    });

    provider.on('status', ({ status }) => setStatus(status));
    provider.on('sync', (isSynced) => setSynced(isSynced));
    provider.on('connection-close', (event) => {
      if (event?.code === CLOSE_UNAUTHORIZED) {
        provider.disconnect();
        logout();
      } else if (event?.code === CLOSE_NOT_FOUND) {
        provider.disconnect();
        setError('This document does not exist.');
      }
    });

    const updatePeople = () => {
      const seen = new Map();
      provider.awareness.getStates().forEach((state) => {
        // One entry per person, even if they have several tabs open.
        if (state.user) seen.set(state.user.id, state.user);
      });
      setPeople([...seen.values()]);
    };
    provider.awareness.on('change', updatePeople);
    updatePeople();

    setSession({ ytext: ydoc.getText('content'), awareness: provider.awareness });

    return () => {
      provider.awareness.off('change', updatePeople);
      provider.destroy();
      ydoc.destroy();
      setSession(null);
      setSynced(false);
    };
  }, [room, user, logout]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the URL is still in the address bar.
    }
  }

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/">Back to documents</Link>
      </div>
    );
  }
  if (!room) return <p className="muted center">Loading…</p>;

  return (
    <div className="page room">
      <div className="room-header">
        <div>
          <Link to="/" className="muted back">
            ← Documents
          </Link>
          <h1>{room.name}</h1>
        </div>
        <div className="room-meta">
          <ul className="people" aria-label="People in this document">
            {people.map((p) => (
              <li key={p.id} title={p.name} style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </li>
            ))}
          </ul>
          <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
          <button className="button secondary" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>

      {session && synced ? (
        <Editor ytext={session.ytext} awareness={session.awareness} />
      ) : (
        <div className="editor placeholder muted">Loading document…</div>
      )}
    </div>
  );
}
