-- A search ignores accents on both sides: "cafe" finds "Café", and "café"
-- finds a note typed without them. Stated here so the dependency is part of
-- the schema rather than of the host; a no-op where the extension exists.
-- unaccent is a trusted extension, so the database owner may create it.

create extension if not exists unaccent;
