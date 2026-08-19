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
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed')),
  final_slot_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  creator_status TEXT NOT NULL DEFAULT 'invited'
);

CREATE TABLE IF NOT EXISTS invitees (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  at TEXT NOT NULL DEFAULT '',
  notified_at TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  event_id TEXT,
  summary TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_emails (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contact_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_owner_email ON contact_emails(owner_id, email);

CREATE TABLE IF NOT EXISTS identities (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);
`;

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function ensureColumn(db, table, name, definition) {
  if (!tableColumns(db, table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migrateLegacyStatus(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'").get();
  if (!row?.sql || !row.sql.includes("'open'")) {
    return;
  }
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE events_new (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed')),
      final_slot_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      creator_status TEXT NOT NULL DEFAULT 'invited'
    );
    INSERT INTO events_new (id, title, created_by, status, final_slot_id)
    SELECT id, title, created_by,
      CASE status WHEN 'final' THEN 'confirmed' WHEN 'confirmed' THEN 'confirmed' ELSE 'proposed' END,
      final_slot_id
    FROM events;
    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;
  `);
  db.pragma("foreign_keys = ON");
}

function migrateEventFields(db) {
  ensureColumn(db, "events", "description", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "events", "venue", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "events", "duration_minutes", "INTEGER NOT NULL DEFAULT 60");
  ensureColumn(db, "events", "creator_status", "TEXT NOT NULL DEFAULT 'invited'");
  ensureColumn(db, "invitees", "status", "TEXT NOT NULL DEFAULT 'invited'");
  ensureColumn(db, "invitees", "at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "invitees", "notified_at", "TEXT NOT NULL DEFAULT ''");
  const inviteColumns = tableColumns(db, "invites");
  if (inviteColumns.includes("at") && tableColumns(db, "invitees").includes("at")) {
    db.exec(`
      UPDATE invitees
      SET at = COALESCE((
        SELECT invites.at FROM invites
        WHERE invites.event_id = invitees.event_id AND invites.user_id = invitees.user_id
      ), at)
      WHERE at = '' OR at IS NULL
    `);
  }
}

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbFile(dataDir));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateLegacyStatus(db);
  migrateEventFields(db);
  return db;
}
