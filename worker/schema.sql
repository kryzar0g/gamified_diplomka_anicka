CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  doc        TEXT NOT NULL DEFAULT '{}',
  rev        INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subs (
  id         TEXT PRIMARY KEY,        -- sha256 endpointu
  room       TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS subs_room ON subs (room);
