import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function dbFile(dataDir) {
  return path.join(dataDir, "calendar.sqlite");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'final')),
  final_slot_id TEXT
);

CREATE TABLE IF NOT EXISTS invitees (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  suggested_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (slot_id, user_id)
);
`;

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbFile(dataDir));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
