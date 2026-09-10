-- Run as schema owner AFTER migrations, with psql variable app_password supplied
-- through an operator-controlled secret input. Never commit the real password.
-- This intentionally fails if the role already exists: rotate it separately.
CREATE ROLE foodlink_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE :"database_name" TO foodlink_app;
GRANT USAGE ON SCHEMA public TO foodlink_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO foodlink_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO foodlink_app;
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM foodlink_app;
REVOKE UPDATE, DELETE ON audit_log, inventory_movements, stripe_events FROM foodlink_app;
-- Run future migrations as this same owner so newly created application tables
-- receive runtime access; separately revoke access to any new privileged tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foodlink_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO foodlink_app;
