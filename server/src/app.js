import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config.js';
import { one } from './db.js';
import { authenticate, HttpError } from './security/auth.js';
import authRoutes from './routes/auth.js';
import { crudRouter } from './crud.js';
import logRoutes from './routes/logs.js';
import analyticsRoutes from './routes/analytics.js';
import supplyRoutes from './routes/supply.js';
import partRoutes from './routes/parts.js';
import adminRoutes, { platformRouter } from './routes/admin.js';

const app = express();
app.set('trust proxy', 1); // behind a cloud load balancer
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"], connectSrc: ["'self'"] } } }));
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Liveness/readiness for load balancers and container orchestrators
app.get('/api/health', async (_req, res) => {
  try { await one('SELECT 1'); res.json({ status: 'ok', uptime: process.uptime() }); } catch { res.status(503).json({ status: 'db_unavailable' }); }
});

app.use('/api/auth', authRoutes);
app.use('/api/platform', platformRouter);
app.use('/api', authenticate);
app.use('/api/e', crudRouter());
app.use('/api/logs', logRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/supply', supplyRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// Serve the built React client (single-container deployment)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Unexpected server error' : err.message });
});

export default app;
