// Local defaults match docker-compose.yml so `npm test` works after `npm run db:up`.
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://app_user:app_dev_pw@localhost:54329/tenancy",
  migrationDatabaseUrl:
    process.env.MIGRATION_DATABASE_URL ??
    "postgres://app_owner:owner_dev_pw@localhost:54329/tenancy",
  jwtSecret:
    process.env.JWT_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
  port: Number(process.env.PORT ?? 3000),
};
