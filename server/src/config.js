import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/smarttakt',
  // Managed Postgres (RDS / Azure / Cloud SQL) normally requires TLS: set PGSSL=true
  pgSsl: process.env.PGSSL === 'true',
  jwtSecret: process.env.JWT_SECRET || (isProd ? null : 'dev-only-secret-change-me'),
  jwtTtl: process.env.JWT_TTL || '8h',
  // Header key that protects the tenant-onboarding endpoint (SaaS operator only)
  platformKey: process.env.PLATFORM_ADMIN_KEY || null,
  corsOrigin: process.env.CORS_ORIGIN || null,
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}
