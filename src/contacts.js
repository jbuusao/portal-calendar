import { isEmail } from "./events.js";

export const DEFAULT_MAX_CONTACTS = 100;
export const MAX_EMAILS_PER_CONTACT = 4;
const NAME_MAX = 80;
const PICTURE_MAX = 500;

export function maxContacts(env = process.env) {
  const value = Number(env.MAX_CONTACTS_ENTRIES);
  if (Number.isInteger(value) && value >= 1 && value <= 10_000) {
    return value;
  }
  return DEFAULT_MAX_CONTACTS;
}

export function parseDisplayName(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function normalizePicture(value) {
  const url = String(value ?? "").trim();
  if (!url) {
    return "";
  }
  if (url.length > PICTURE_MAX) {
    throw Object.assign(new Error("picture URL is too long"), { status: 400 });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error("picture must be an http(s) URL"), { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw Object.assign(new Error("picture must be an http(s) URL"), { status: 400 });
  }
  return url;
}

function optionalPicture(value) {
  if (value == null || String(value).trim() === "") {
    return "";
  }
  try {
    return normalizePicture(value);
  } catch {
    return "";
  }
}

function clipName(value) {
  return String(value ?? "").trim().slice(0, NAME_MAX);
}

export function personNameOf(contact) {
  const nick = String(contact?.nickname ?? "").trim();
  if (nick) {
    return nick;
  }
  return [contact?.firstName, contact?.lastName].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
}

export function displayNameOf(contact) {
  return personNameOf(contact) || contact?.emails?.[0] || "";
}

export { correspondenceName } from "./names.js";

export function personLookupKeys(userId, extras = []) {
  const keys = [];
  const add = (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    if (text && !keys.includes(text)) {
      keys.push(text);
    }
  };
  add(userId);
  for (const extra of extras) {
    add(extra);
  }
  return keys;
}

export function contactMatchesPerson(contact, userId, extras = []) {
  const keys = new Set(personLookupKeys(userId, extras));
  const id = String(userId ?? "").trim().toLowerCase();
  return (contact?.emails ?? []).some((email) => {
    const value = String(email ?? "").trim().toLowerCase();
    if (!value) {
      return false;
    }
    if (keys.has(value)) {
      return true;
    }
    if (!id.includes("@") && value.split("@")[0] === id) {
      return true;
    }
    return false;
  });
}

export function findContactForPerson(db, ownerId, userId, extras = []) {
  if (!ownerId || !userId) {
    return null;
  }
  const keys = personLookupKeys(userId, extras);
  for (const key of keys) {
    if (isEmail(key)) {
      const found = findContactByEmail(db, ownerId, key);
      if (found) {
        return found;
      }
    }
  }
  return listContacts(db, ownerId).find((contact) => contactMatchesPerson(contact, userId, extras)) ?? null;
}

export function serializeContact(row, emails) {
  const contact = {
    id: row.id,
    ownerId: row.owner_id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    nickname: row.nickname || "",
    picture: row.picture || "",
    emails: emails.map((item) => item.email),
  };
  contact.displayName = displayNameOf(contact);
  return contact;
}

function emailsOf(rowId, db) {
  return db
    .prepare("SELECT email, position FROM contact_emails WHERE contact_id = ? ORDER BY position, email")
    .all(rowId);
}

export function listContacts(db, ownerId) {
  const rows = db.prepare("SELECT id, owner_id, first_name, last_name, nickname, picture FROM contacts WHERE owner_id = ?").all(ownerId);
  const contacts = rows.map((row) => serializeContact(row, emailsOf(row.id, db)));
  contacts.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  return contacts;
}

export function loadContact(db, ownerId, id) {
  const row = db.prepare("SELECT id, owner_id, first_name, last_name, nickname, picture FROM contacts WHERE id = ? AND owner_id = ?").get(id, ownerId);
  return row ? serializeContact(row, emailsOf(row.id, db)) : null;
}

function normalizeEmails(raw) {
  const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!list.length) {
    throw Object.assign(new Error("at least one email is required"), { status: 400 });
  }
  if (list.length > MAX_EMAILS_PER_CONTACT) {
    throw Object.assign(new Error(`at most ${MAX_EMAILS_PER_CONTACT} emails per contact`), { status: 400 });
  }
  for (const email of list) {
    if (!isEmail(email)) {
      throw Object.assign(new Error("invalid email"), { status: 400 });
    }
  }
  return list;
}

function assertUniqueEmails(db, ownerId, emails, exceptContactId = null) {
  const existing = db
    .prepare(
      `SELECT email FROM contact_emails
       WHERE owner_id = ? AND email IN (${emails.map(() => "?").join(",")})
         AND contact_id != ?`,
    )
    .all(ownerId, ...emails, exceptContactId || "");
  if (existing.length) {
    throw Object.assign(new Error("that email is already in your address book"), { status: 409 });
  }
}

function insertEmails(db, ownerId, contactId, emails) {
  const insert = db.prepare("INSERT INTO contact_emails (contact_id, owner_id, email, position) VALUES (?, ?, ?, ?)");
  emails.forEach((email, index) => {
    insert.run(contactId, ownerId, email, index);
  });
}

export function createContact(db, ownerId, raw, { max = DEFAULT_MAX_CONTACTS } = {}) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE owner_id = ?").get(ownerId).n;
  if (count >= max) {
    throw Object.assign(new Error(`address book is limited to ${max} contacts`), { status: 409 });
  }
  const emails = normalizeEmails(raw?.emails);
  assertUniqueEmails(db, ownerId, emails);
  const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO contacts (id, owner_id, first_name, last_name, nickname, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, ownerId, clipName(raw?.firstName), clipName(raw?.lastName), clipName(raw?.nickname), normalizePicture(raw?.picture ?? "") || "", now, now);
    insertEmails(db, ownerId, id, emails);
  })();
  return loadContact(db, ownerId, id);
}

export function updateContact(db, ownerId, id, raw) {
  const existing = loadContact(db, ownerId, id);
  if (!existing) {
    throw Object.assign(new Error("contact not found"), { status: 404 });
  }
  const emails = raw?.emails != null ? normalizeEmails(raw.emails) : existing.emails;
  assertUniqueEmails(db, ownerId, emails, id);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "UPDATE contacts SET first_name = ?, last_name = ?, nickname = ?, picture = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    ).run(
      raw?.firstName != null ? clipName(raw.firstName) : existing.firstName,
      raw?.lastName != null ? clipName(raw.lastName) : existing.lastName,
      raw?.nickname != null ? clipName(raw.nickname) : existing.nickname,
      raw?.picture != null ? normalizePicture(raw.picture) || "" : existing.picture,
      now,
      id,
      ownerId,
    );
    db.prepare("DELETE FROM contact_emails WHERE contact_id = ?").run(id);
    insertEmails(db, ownerId, id, emails);
  })();
  return loadContact(db, ownerId, id);
}

export function deleteContact(db, ownerId, id) {
  const result = db.prepare("DELETE FROM contacts WHERE id = ? AND owner_id = ?").run(id, ownerId);
  if (!result.changes) {
    throw Object.assign(new Error("contact not found"), { status: 404 });
  }
}

export function findContactByEmail(db, ownerId, email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT contacts.id, contacts.owner_id, contacts.first_name, contacts.last_name, contacts.nickname, contacts.picture
       FROM contact_emails
       JOIN contacts ON contacts.id = contact_emails.contact_id
       WHERE contact_emails.owner_id = ? AND contact_emails.email = ?`,
    )
    .get(ownerId, normalized);
  return row ? serializeContact(row, emailsOf(row.id, db)) : null;
}

export function ensureContactsForEmails(db, ownerId, emails, { max = DEFAULT_MAX_CONTACTS } = {}) {
  const created = [];
  for (const raw of emails ?? []) {
    const email = String(raw ?? "").trim().toLowerCase();
    if (!isEmail(email) || findContactByEmail(db, ownerId, email)) {
      continue;
    }
    try {
      created.push(createContact(db, ownerId, { emails: [email] }, { max }));
    } catch (err) {
      if (err?.status === 409) {
        break;
      }
      throw err;
    }
  }
  return created;
}

export function syncProfileIntoContacts(db, profile) {
  const email = String(profile?.email ?? "").trim().toLowerCase();
  if (!isEmail(email)) {
    return 0;
  }
  const firstName = clipName(profile.firstName || profile.givenName);
  const lastName = clipName(profile.lastName || profile.familyName);
  const picture = optionalPicture(profile.picture);
  if (!firstName && !lastName && !picture) {
    return 0;
  }
  const rows = db.prepare("SELECT DISTINCT contact_id FROM contact_emails WHERE email = ?").all(email);
  if (!rows.length) {
    return 0;
  }
  const now = new Date().toISOString();
  const update = db.prepare(
    `UPDATE contacts SET
       first_name = CASE WHEN ? != '' THEN ? ELSE first_name END,
       last_name = CASE WHEN ? != '' THEN ? ELSE last_name END,
       picture = CASE WHEN ? != '' THEN ? ELSE picture END,
       updated_at = ?
     WHERE id = ?`,
  );
  const apply = db.transaction(() => {
    for (const row of rows) {
      update.run(firstName, firstName, lastName, lastName, picture, picture, now, row.contact_id);
    }
  });
  apply();
  return rows.length;
}

function serializeIdentity(row) {
  if (!row) {
    return null;
  }
  return {
    userId: row.user_id,
    email: row.email || "",
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    picture: row.picture || "",
  };
}

export function upsertIdentity(db, user) {
  const userId = String(user?.id ?? "").trim();
  const email = String(user?.email ?? "").trim().toLowerCase();
  if (!userId && !email) {
    return null;
  }
  const firstName = clipName(user.firstName || user.givenName);
  const lastName = clipName(user.lastName || user.familyName);
  const picture = optionalPicture(user.picture);
  const key = userId || email;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO identities (user_id, email, first_name, last_name, picture, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email = CASE WHEN excluded.email != '' THEN excluded.email ELSE identities.email END,
       first_name = CASE WHEN excluded.first_name != '' THEN excluded.first_name ELSE identities.first_name END,
       last_name = CASE WHEN excluded.last_name != '' THEN excluded.last_name ELSE identities.last_name END,
       picture = CASE WHEN excluded.picture != '' THEN excluded.picture ELSE identities.picture END,
       updated_at = excluded.updated_at`,
  ).run(key, email, firstName, lastName, picture, now);
  return findIdentity(db, key, [email]);
}

export function findIdentity(db, userId, extraKeys = []) {
  const keys = [...new Set([userId, ...extraKeys].map((item) => String(item ?? "").trim()).filter(Boolean))];
  for (const key of keys) {
    const row = db.prepare("SELECT user_id, email, first_name, last_name, picture FROM identities WHERE user_id = ? OR email = ?").get(key, key.toLowerCase());
    if (row) {
      return serializeIdentity(row);
    }
  }
  return null;
}

export function rememberIdentity(db, user) {
  const identity = upsertIdentity(db, user);
  syncProfileIntoContacts(db, user);
  return identity;
}
