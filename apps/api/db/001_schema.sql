-- First-version transactional repository. Automatically initialized at startup.
-- All mutations lock this row. Do not use multiple independent copies/databases
-- for app instances serving the same tenants.
create table if not exists meet8_state (
  id integer primary key check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
