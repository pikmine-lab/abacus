-- Mirrors what the socle provisioner runs when creating a per-app database
-- on the shared instance: the three extensions, in the app's own database.
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
