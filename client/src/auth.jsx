import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  // On page load, turn a saved token back into a user (or drop it if expired).
  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const finishAuth = useCallback(({ token, user }) => {
    setToken(token);
    setUser(user);
  }, []);

  const login = useCallback(
    (email, password) => api.login(email, password).then(finishAuth),
    [finishAuth]
  );
  const register = useCallback(
    (email, name, password) => api.register(email, name, password).then(finishAuth),
    [finishAuth]
  );
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
