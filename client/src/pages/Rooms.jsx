import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export default function Rooms() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listRooms()
      .then(({ rooms }) => setRooms(rooms))
      .catch((err) => setError(err.message));
  }, []);

  async function onCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const { room } = await api.createRoom(name);
      navigate(`/r/${room.slug}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h1>Documents</h1>

      <form onSubmit={onCreate} className="new-room">
        <input
          placeholder="Name a new document, like “Meeting notes”"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
        <button type="submit" className="button">
          Create
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {rooms === null && !error && <p className="muted">Loading…</p>}
      {rooms?.length === 0 && <p className="muted">No documents yet. Create the first one above.</p>}
      {rooms?.length > 0 && (
        <ul className="room-list">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link to={`/r/${room.slug}`} className="room-row">
                <span className="room-name">{room.name}</span>
                <span className="muted">
                  {room.owner_name} · {room.last_edited_at ? `edited ${timeAgo(room.last_edited_at)}` : 'not edited yet'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
