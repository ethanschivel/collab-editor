import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const TOKEN_TTL = '7d';

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user, secret) {
  return jwt.sign({ sub: user.id, name: user.name }, secret, { expiresIn: TOKEN_TTL });
}

// Returns the token payload, or null if the token is missing, invalid or expired.
export function verifyToken(token, secret) {
  if (!token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

// Express middleware: requires "Authorization: Bearer <token>".
export function requireAuth(secret) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verifyToken(token, secret);
    if (!payload) return res.status(401).json({ error: 'Please log in' });
    req.userId = payload.sub;
    next();
  };
}
