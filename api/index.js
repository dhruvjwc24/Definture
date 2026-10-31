// Vercel serverless entrypoint: exports the Express app (no listen()). vercel.json rewrites /api/* here.
export { default } from '../server/src/app.js';
