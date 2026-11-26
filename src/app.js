import http from 'node:http';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { createLive } from './live.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRoutes } from './routes/auth.js';
import { matchRoutes } from './routes/matches.js';
import { teamRoutes } from './routes/teams.js';

export function createApp(config) {
  const app = express();
  const server = http.createServer(app);
  const live = createLive(server, config);

  app.set('trust proxy', 1); // Render and similar hosts sit behind one proxy
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(compression());
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ ok });
  });
  app.use('/api/auth', authRoutes(config));
  app.use('/api/teams', teamRoutes(config));
  app.use('/api/matches', matchRoutes(config, live));
  app.use(notFound);
  app.use(errorHandler);

  return { app, server, live };
}
