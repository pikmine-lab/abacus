-- Mirrors what the socle provisioner runs when creating a per-app database
-- on the shared instance: the three extensions, in the app's own database.
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Local-only extra: a second database for the integration tests, so `nr test`
-- never wipes the dev data.
create database abacus_test owner abacus;
\connect abacus_test
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
