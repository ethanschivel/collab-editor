import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Rooms from './pages/Rooms.jsx';
// The editor (CodeMirror + syntax highlighting) is most of the bundle, so it
// only loads when you open a document.
const Room = lazy(() => import('./pages/Room.jsx'));

function RequireLogin({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Collab Editor
        </Link>
        {user && (
          <div className="topbar-user">
            <span className="muted">{user.name}</span>
            <button className="link-button" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireLogin>
                <Rooms />
              </RequireLogin>
            }
          />
          <Route
            path="/r/:slug"
            element={
              <RequireLogin>
                <Suspense fallback={<p className="muted center">Loading…</p>}>
                  <Room />
                </Suspense>
              </RequireLogin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
