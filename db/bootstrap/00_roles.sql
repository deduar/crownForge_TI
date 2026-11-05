-- Cluster bootstrap (runs once, as superuser, via /docker-entrypoint-initdb.d).
-- Roles are cluster-level objects, so they live outside the versioned migrations.
-- Passwords are for local/CI only; in production they come from a secret manager.

-- Owns the schema and runs migrations. NOT a superuser.
CREATE ROLE app_owner LOGIN PASSWORD 'owner_dev_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB;

-- Used by the API at runtime. Only DML, and explicitly cannot bypass RLS.
CREATE ROLE app_user LOGIN PASSWORD 'app_dev_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

ALTER SCHEMA public OWNER TO app_owner;
GRANT CREATE ON DATABASE tenancy TO app_owner;
