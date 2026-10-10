-- The language the web interface speaks to a person, settled once like the
-- reading and the ranking view (see 0015 for the table).
--
-- Null is a value of its own: the person never chose, and the interface
-- follows what their browser asks for. Writing the browser's language here
-- by default would freeze a guess into a choice, and the person moving to
-- another browser would no longer be followed.
--
-- The check lists the languages the interface ships catalogs for. Adding one
-- is a catalog and a line here, never a component.
--
-- A display, nothing more: data is never translated. What a person typed
-- (a category, an actor, a regime copied into an activity) stays in the words
-- they typed it in, whichever language the interface speaks.

alter table user_preference
  add column language text check (language in ('fr', 'en'));
