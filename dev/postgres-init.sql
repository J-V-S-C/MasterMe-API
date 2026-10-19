-- Local stand-in for the Supabase Auth table referenced by application migrations.
-- Authentication still happens against the separate development Supabase project.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
