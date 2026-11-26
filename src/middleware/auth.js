import jwt from 'jsonwebtoken';

export const requireAdmin = (config) => (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Please log in' });
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    // Changing ADMIN_ID immediately invalidates old sessions.
    if (payload.sub !== config.adminId) throw new Error('stale');
    req.admin = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
};
