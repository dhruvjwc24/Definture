# Smart TAKT Board — Installation and Component Inventory

Use this document to rebuild the system on another machine or in the cloud. Versions below are those on the development machine (macOS, Apple Silicon) at the time of writing; package versions are the semver ranges in `server/package.json` and `client/package.json` (exact resolved versions are pinned in each `package-lock.json`).

## 1. Component Inventory

### 1.1 System-level components

| Component | Version | Purpose | Installed via |
|---|---|---|---|
| Node.js | 24.x (dev machine: v24.22.1); 20 LTS or newer works | Runtime for API and build tooling | nvm / Homebrew / apt / Docker image |
| npm | 11.x (dev: 11.19.1) | Package manager | Bundled with Node |
| PostgreSQL | 16 (dev: 16.15) | System of record | `brew install postgresql@16` |
| pgcrypto extension | bundled with PostgreSQL contrib | `gen_random_uuid()` and crypto helpers | `CREATE EXTENSION pgcrypto` (done by schema script) |
| Docker / Docker Compose (optional) | current | Container build and local stack | Docker Desktop / docker engine |
| pandoc (optional, docs only) | any | Builds the combined DOCX of these docs | `brew install pandoc` |

### 1.2 Server npm packages (`server/package.json`)

| Package | Range | Purpose |
|---|---|---|
| express | ^5.3.0 | HTTP API framework |
| pg | ^8.23.1 | PostgreSQL client and connection pool |
| bcryptjs | ^3.0.3 | Password hashing (pure JS, no native build) |
| jsonwebtoken | ^9.0.3 | Signed access tokens |
| helmet | ^8.3.0 | Security headers |
| cors | ^2.8.6 | Cross-origin control |
| compression | ^1.8.2 | Response compression |
| express-rate-limit | ^8.7.1 | Brute-force protection on login and API |
| dotenv | ^18.0.9 | Load `.env` for local development |

Scripts: `start`, `dev` (node --watch), `db:schema`, `db:seed`, `db:reset`.

### 1.3 Client npm packages (`client/package.json`)

| Package | Range | Purpose |
|---|---|---|
| react, react-dom | ^19.3.1 | UI framework |
| react-router-dom | ^7.18.5 | Client-side routing |
| recharts | ^3.10.1 | Charts (Pareto, trend, Yamazumi, donuts) |
| lucide-react | ^1.62.0 | Icon set |
| vite | ^8.3.5 | Dev server and production bundler |
| @vitejs/plugin-react | ^6.1.2 | React support for Vite |
| oxlint | ^1.89.0 | Linting |
| @types/react, @types/react-dom | ^19.3.0 | Editor typings |

## 2. Environment Variables

| Variable | Required | Example | Description |
|---|---|---|---|
| DATABASE_URL | yes | `postgres://user:pass@host:5432/smarttakt` | PostgreSQL connection string |
| JWT_SECRET | yes (production) | long random string (32+ bytes) | Signs access tokens; keep in a secrets manager |
| PORT | no | `4000` (default) | API listen port |
| NODE_ENV | no | `production` | Enables production behaviour |
| PGSSL | no | `true` | Enable TLS to the database (managed cloud Postgres) |

Local development example (`server/.env`):

```
DATABASE_URL=postgres://localhost:5432/smarttakt
JWT_SECRET=change-me-in-production
PORT=4000
```

## 3. Local Installation — macOS

```bash
# 1. Prerequisites
brew install node postgresql@16
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# 2. Database
createdb smarttakt
psql -d smarttakt -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"

# 3. Server
cd server
npm install
cp .env.example .env        # or create .env as shown above
npm run db:reset            # drops and recreates schema, then seeds demo data
npm run dev                 # API on http://localhost:4000

# 4. Client (second terminal)
cd client
npm install
npm run dev                 # UI on http://localhost:5173
```

Reset or reseed:

```bash
npm run db:schema   # recreate schema only (destroys data)
npm run db:seed     # load demo data
npm run db:reset    # schema + seed
```

`db:reset` destroys all data. Never run it against production.

## 4. Local Installation — Ubuntu 22.04/24.04

```bash
# Node.js 22/24 via NodeSource (or use nvm)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL 16 from the PGDG repository
sudo apt-get install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update && sudo apt-get install -y postgresql-16 postgresql-contrib

# Database and user
sudo -u postgres psql -c "CREATE USER smarttakt WITH PASSWORD 'change-me';"
sudo -u postgres createdb -O smarttakt smarttakt
sudo -u postgres psql -d smarttakt -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# App
cd server && npm install
echo "DATABASE_URL=postgres://smarttakt:change-me@localhost:5432/smarttakt" > .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
npm run db:reset && npm run dev
cd ../client && npm install && npm run dev
```

## 5. Production Build

```bash
cd client && npm ci && npm run build      # outputs client/dist
cd ../server && npm ci --omit=dev
NODE_ENV=production node src/index.js     # API; serve client/dist via the API or a CDN
```

## 6. Docker

The repository root contains the working `Dockerfile`, `docker-compose.yml` and `.dockerignore`; the listings below mirror them in simplified form. After `docker compose up --build`, run `docker compose run --rm app npm --prefix server run db:reset` once to create the schema and demo tenant.

`Dockerfile` (multi-stage):

```dockerfile
FROM node:24-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=client /app/client/dist ./client/dist
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "server/src/index.js"]
```

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: smarttakt
      POSTGRES_USER: smarttakt
      POSTGRES_PASSWORD: change-me
    volumes: [pgdata:/var/lib/postgresql/data]
  app:
    build: .
    depends_on: [db]
    environment:
      DATABASE_URL: postgres://smarttakt:change-me@db:5432/smarttakt
      JWT_SECRET: change-me-in-production
      PORT: 4000
    ports: ["4000:4000"]
volumes:
  pgdata:
```

Commands:

```bash
docker compose up -d --build
docker compose exec app node server/db/run-schema.js   # first run only
docker compose exec app node server/db/seed.js         # demo data (non-production)
```

## 7. Cloud Hosting Steps

Generic (any provider):

1. Provision managed PostgreSQL 16 with automated backups, TLS enforced, private networking.
2. Create database `smarttakt` and run the schema script once from a CI job or bastion (`node server/db/run-schema.js`). Do not seed demo data in production; create the first tenant and admin through a provisioning script.
3. Store `DATABASE_URL` and `JWT_SECRET` in the provider's secrets manager; set `NODE_ENV=production`, `PGSSL=true`.
4. Build the container image, push to a registry, deploy as a stateless service with at least two instances behind a TLS load balancer.
5. Configure the health probe on `GET /api/health`.
6. Optionally host `client/dist` on a CDN (S3 + CloudFront, Azure Storage + Front Door, GCS + Cloud CDN) and route `/api/*` to the service.
7. Configure log shipping and alerts (5xx rate, latency, database CPU/connections).
8. Set up a custom domain and managed certificate.

Provider mapping:

| Need | AWS | Azure | GCP |
|---|---|---|---|
| Container runtime | ECS Fargate or App Runner | App Service for Containers / Container Apps | Cloud Run |
| Database | RDS PostgreSQL 16 (Multi-AZ) | Azure Database for PostgreSQL Flexible Server | Cloud SQL for PostgreSQL |
| Secrets | Secrets Manager | Key Vault | Secret Manager |
| Registry | ECR | ACR | Artifact Registry |
| Load balancer / CDN | ALB + CloudFront | Front Door | HTTPS LB + Cloud CDN |
| Logs | CloudWatch | Application Insights | Cloud Logging |

Notes: allow the pg pool size to match instance count against the database connection limit (use RDS Proxy, PgBouncer or Cloud SQL connector at scale); enable `PGSSL=true` and use the provider CA bundle when verifying certificates.

## 8. Demo Data and Logins

After `npm run db:reset` the seed creates tenant "Apex Turbo Systems" with the turbocharger line, supplier organizations, 30 days of logs, inventory, POs and shipments.

Company code: `apex`   Password for all demo users: `Welcome1!`

| Email | Persona |
|---|---|
| admin@apex.com | Tenant Admin |
| exec@apex.com | Executive |
| gm@apex.com | Plant Manager / GM |
| manager@apex.com | Manager |
| supervisor@apex.com | Supervisor |
| lead@apex.com | Lead |
| operator@apex.com | Operator |
| planner@apex.com | Supply Chain Planner |
| quality@apex.com | Quality Engineer |
| supplier.admin@castings.com | Supplier Admin (Precision Castings) |
| supplier.op@castings.com | Supplier Operator (Precision Castings) |

Change all passwords and the `JWT_SECRET` before any shared or production use.

## 9. Verification Checklist

1. `pg_isready` reports accepting connections; `psql -d smarttakt -c "\dt"` lists tables.
2. `curl http://localhost:4000/api/health` returns OK.
3. Sign in as `exec@apex.com` and confirm the Executive dashboard shows data.
4. Sign in as `supplier.op@castings.com` and confirm only supplier records are visible.
5. Sign in as `operator@apex.com` and confirm only assigned machines appear in Log Entry.
