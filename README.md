# Smart TAKT Board

Multi-tenant SaaS for OEE / TAKT shop-floor analytics and supplier-aware inventory visibility.
Stack: Node 24 + Express 5 API, PostgreSQL 16, React (Vite) client served by the API.

## Run locally
```bash
# 1. PostgreSQL 16 running, then:
cd server && cp .env.example .env && npm install
npm run db:reset          # creates schema and seeds demo tenant "apex" (DESTRUCTIVE: drops public schema)
cd ../client && npm install && npm run build
cd ../server && npm start # http://localhost:4000
```
Dev with hot reload: `npm run dev` in `server/` and `client/` (client proxies /api to :4000).
Tests (need a freshly seeded DB): `cd server && npm run db:reset && npm test`.

## Docker
`docker compose up --build`, then once: `docker compose run --rm app npm --prefix server run db:reset`.

## Demo logins
Company code `apex`, password `Welcome1!`: exec@apex.com, admin@apex.com, gm@apex.com, manager@apex.com, supervisor@apex.com,
lead@apex.com, operator@apex.com, planner@apex.com, quality@apex.com, supplier.admin@castings.com, supplier.op@castings.com.

## Cloud
Set `DATABASE_URL`, `PGSSL=true`, a long random `JWT_SECRET` and `PLATFORM_ADMIN_KEY`; health probe `/api/health`.
Never run `db:reset` against production. See `docs/` for BRD, requirements, stories, diagrams, design and install guide.

## Vercel
`vercel.json` builds `client/` to static files and serves the Express app (`server/src/app.js`) as a serverless function via `api/index.js`.
1. Create a Neon Postgres database (Vercel → Storage → Neon). Use the pooled connection string (`-pooler` host).
2. One time, against the empty Neon DB: `cd server && DATABASE_URL='<neon url>' PGSSL=true npm run db:schema && DATABASE_URL='<neon url>' PGSSL=true npm run db:seed`.
3. In Vercel project settings add env vars: `DATABASE_URL`, `PGSSL=true`, `JWT_SECRET`, `PLATFORM_ADMIN_KEY`, `NODE_ENV=production`, `PG_POOL_MAX=3`.
4. Import the repo at vercel.com/new (or run `vercel`), then check `/api/health`.
`server/src/index.js` (with `listen`) remains the entrypoint for local dev and Docker.
