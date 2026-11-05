-- Demo data: two companies with deliberately similar data.
-- Runs as app_owner, which is ALSO subject to RLS (FORCE), so each block must
-- declare its tenant first. TRUNCATE is not governed by RLS (owner-only privilege).

BEGIN;
TRUNCATE projects, users, companies;

SELECT set_config('app.company_id', 'aaaaaaaa-0000-0000-0000-000000000000', true);
INSERT INTO companies (id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000000', 'Acme Corp');
INSERT INTO users (id, email) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'alice@acme.test');
INSERT INTO projects (id, owner_id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Acme – Website'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Acme – Mobile app');

SELECT set_config('app.company_id', 'bbbbbbbb-0000-0000-0000-000000000000', true);
INSERT INTO companies (id, name) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'Globex Inc');
INSERT INTO users (id, email) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', 'bob@globex.test');
INSERT INTO projects (id, owner_id, name) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Globex – Secret plan');
COMMIT;
