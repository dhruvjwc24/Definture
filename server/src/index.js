// Long-running entrypoint (local dev, Docker, Render/Railway). On Vercel the app is imported by /api/index.js instead.
import app from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const server = app.listen(config.port, () => console.log(`Smart TAKT Board API listening on :${config.port}`));
const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
