const TOKEN_KEY = 'collab-editor-token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can block storage; the session just won't persist.
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong', res.status);
  return data;
}

export const api = {
  register: (email, name, password) => request('POST', '/register', { email, name, password }),
  login: (email, password) => request('POST', '/login', { email, password }),
  me: () => request('GET', '/me'),
  listRooms: () => request('GET', '/rooms'),
  createRoom: (name) => request('POST', '/rooms', { name }),
  getRoom: (slug) => request('GET', `/rooms/${encodeURIComponent(slug)}`),
};

// Sync server URL: set by VITE_WS_URL in development, same host in production.
export const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
