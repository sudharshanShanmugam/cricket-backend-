import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { HttpError, parse } from '../middleware/errors.js';

const digest = (value) => createHash('sha256').update(value).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

const loginSchema = z.object({
  adminId: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

export function authRoutes(config) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many failed attempts. Try again in 15 minutes.' },
  });

  router.post('/login', limiter, (req, res) => {
    const { adminId, password } = parse(loginSchema, req.body);
    const idOk = safeEqual(adminId, config.adminId);
    const passwordOk = safeEqual(password, config.adminPassword);
    if (!idOk || !passwordOk) throw new HttpError(401, 'Wrong admin ID or password');
    const token = jwt.sign({ role: 'scorer' }, config.jwtSecret, {
      subject: config.adminId,
      expiresIn: config.tokenTtl,
      algorithm: 'HS256',
    });
    res.json({ token, adminId: config.adminId });
  });

  router.get('/me', requireAdmin(config), (req, res) => res.json({ adminId: req.admin }));

  return router;
}
