import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { simulateInvites } from "./invite.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const START_RE = /^(0[6-9]|1\d|2[0-2]):00$/;

export function isEmail(value) {
  return EMAIL_RE.test(value);
}

export function eventsFile(dataDir) {
  return path.join(dataDir, "events.json");
}

function needsExampleSeed(raw) {
  if (!Array.isArray(raw)) {
    return true;
  }
  if (raw.length === 0) {
    return false;
  }
  return raw.every((item) => !item || typeof item !== "object" || !String(item.createdBy ?? "").trim());
}

export function isIsoDate(value) {
  if (!DATE_RE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isSlotStart(value) {
  return START_RE.test(value);
}

export function participantIds(event) {
  return [...new Set([event.createdBy, ...event.inviteeIds])];
}

export function isParticipant(event, userId) {
  return participantIds(event).includes(userId);
}

function normalizeInvites(raw, eventId, inviteeIds) {
  const source = Array.isArray(raw) ? raw : simulateInvites(eventId, inviteeIds);
  return inviteeIds.map((userId) => {
    const existing = source.find((item) => item && item.userId === userId);
    return {
      eventId,
      userId,
      at: String(existing?.at ?? new Date().toISOString()),
    };
  });
}

function normalizeSlot(raw, index) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`slots[${index}] is invalid`);
  }
  const id = String(raw.id ?? `s-${index + 1}`);
  const date = String(raw.date ?? "").trim();
  const start = String(raw.start ?? "").trim();
  const suggestedBy = String(raw.suggestedBy ?? "").trim();
  if (!isIsoDate(date)) {
    throw new Error(`slots[${index}].date must be YYYY-MM-DD`);
  }
  if (!isSlotStart(start)) {
    throw new Error(`slots[${index}].start must be HH:00 between 06:00 and 22:00`);
  }
  if (!suggestedBy) {
    throw new Error(`slots[${index}].suggestedBy is required`);
  }
  return { id, date, start, suggestedBy };
}

function normalizeVote(raw, index, slotIds) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`votes[${index}] is invalid`);
  }
  const slotId = String(raw.slotId ?? "").trim();
  const userId = String(raw.userId ?? "").trim();
  if (!slotIds.has(slotId) || !userId) {
    throw new Error(`votes[${index}] is invalid`);
  }
  return { slotId, userId };
}

export function normalizeEvent(raw, index, knownUserIds) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`events[${index}] is invalid`);
  }
  const id = String(raw.id ?? `evt-${index + 1}`);
  const title = String(raw.title ?? "").trim();
  const createdBy = String(raw.createdBy ?? "").trim();
  if (!title) {
    throw new Error(`events[${index}].title is required`);
  }
  if (!createdBy || (knownUserIds && !knownUserIds.has(createdBy))) {
    throw new Error(`events[${index}].createdBy is invalid`);
  }
  const inviteeIds = [...new Set((Array.isArray(raw.inviteeIds) ? raw.inviteeIds : []).map((item) => String(item).trim()))]
    .filter((userId) => userId && userId !== createdBy)
    .filter((userId) => !knownUserIds || knownUserIds.has(userId));
  const status = raw.status === "final" ? "final" : "open";
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).map(normalizeSlot);
  const slotIds = new Set(slots.map((slot) => slot.id));
  const votes = [];
  const seenVotes = new Set();
  for (const [voteIndex, item] of (Array.isArray(raw.votes) ? raw.votes : []).entries()) {
    const vote = normalizeVote(item, voteIndex, slotIds);
    if (!isParticipant({ createdBy, inviteeIds }, vote.userId)) {
      continue;
    }
    const key = `${vote.slotId}:${vote.userId}`;
    if (seenVotes.has(key)) {
      continue;
    }
    seenVotes.add(key);
    votes.push(vote);
  }
  let finalSlotId = raw.finalSlotId == null || raw.finalSlotId === "" ? null : String(raw.finalSlotId);
  if (status === "final") {
    if (!finalSlotId || !slotIds.has(finalSlotId)) {
      throw new Error(`events[${index}].finalSlotId is required when final`);
    }
  } else {
    finalSlotId = null;
  }
  return {
    id,
    title,
    createdBy,
    inviteeIds,
    invites: normalizeInvites(raw.invites, id, inviteeIds),
    status,
    finalSlotId,
    slots,
    votes,
  };
}

export function normalizeEvents(raw, knownUserIds) {
  if (!Array.isArray(raw)) {
    throw new Error("events must be an array");
  }
  return raw.map((item, index) => normalizeEvent(item, index, knownUserIds));
}

function rowToEvent(db, row) {
  const inviteeIds = db.prepare("SELECT user_id FROM invitees WHERE event_id = ? ORDER BY user_id").all(row.id).map((item) => item.user_id);
  const invites = db
    .prepare("SELECT event_id, user_id, at FROM invites WHERE event_id = ? ORDER BY user_id")
    .all(row.id)
    .map((item) => ({ eventId: item.event_id, userId: item.user_id, at: item.at }));
  const slots = db
    .prepare("SELECT id, date, start, suggested_by FROM slots WHERE event_id = ? ORDER BY date, start")
    .all(row.id)
    .map((item) => ({ id: item.id, date: item.date, start: item.start, suggestedBy: item.suggested_by }));
  const votes = db
    .prepare(
      `SELECT votes.slot_id, votes.user_id
       FROM votes
       JOIN slots ON slots.id = votes.slot_id
       WHERE slots.event_id = ?
       ORDER BY votes.slot_id, votes.user_id`,
    )
    .all(row.id)
    .map((item) => ({ slotId: item.slot_id, userId: item.user_id }));
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    inviteeIds,
    invites,
    status: row.status,
    finalSlotId: row.final_slot_id,
    slots,
    votes,
  };
}

export function loadEvents(db) {
  return db.prepare("SELECT id, title, created_by, status, final_slot_id FROM events ORDER BY id").all().map((row) => rowToEvent(db, row));
}

export function loadEvent(db, id) {
  const row = db.prepare("SELECT id, title, created_by, status, final_slot_id FROM events WHERE id = ?").get(id);
  return row ? rowToEvent(db, row) : null;
}

export function saveEvent(db, event) {
  const persist = db.transaction((item) => {
    db.prepare("DELETE FROM events WHERE id = ?").run(item.id);
    db.prepare("INSERT INTO events (id, title, created_by, status, final_slot_id) VALUES (?, ?, ?, ?, ?)").run(
      item.id,
      item.title,
      item.createdBy,
      item.status,
      item.finalSlotId,
    );
    const insertInvitee = db.prepare("INSERT INTO invitees (event_id, user_id) VALUES (?, ?)");
    for (const userId of item.inviteeIds) {
      insertInvitee.run(item.id, userId);
    }
    const insertInvite = db.prepare("INSERT INTO invites (event_id, user_id, at) VALUES (?, ?, ?)");
    for (const invite of item.invites) {
      insertInvite.run(item.id, invite.userId, invite.at);
    }
    const insertSlot = db.prepare("INSERT INTO slots (id, event_id, date, start, suggested_by) VALUES (?, ?, ?, ?, ?)");
    for (const slot of item.slots) {
      insertSlot.run(slot.id, item.id, slot.date, slot.start, slot.suggestedBy);
    }
    const insertVote = db.prepare("INSERT INTO votes (slot_id, user_id) VALUES (?, ?)");
    for (const vote of item.votes) {
      insertVote.run(vote.slotId, vote.userId);
    }
  });
  persist(event);
  return event;
}

function tryReadJsonEvents(file, knownUserIds) {
  if (!file || !existsSync(file)) {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (needsExampleSeed(raw)) {
    return null;
  }
  try {
    return normalizeEvents(raw, knownUserIds);
  } catch {
    return null;
  }
}

export function initializeEventsStore(db, { dataDir, examplePath, knownUserIds, seedExample = false } = {}) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  if (count > 0) {
    return;
  }
  const imported = tryReadJsonEvents(eventsFile(dataDir), knownUserIds);
  if (imported) {
    const persist = db.transaction((events) => {
      for (const event of events) {
        saveEvent(db, event);
      }
    });
    persist(imported);
    return;
  }
  if (!seedExample || !examplePath) {
    return;
  }
  const seeded = tryReadJsonEvents(examplePath, knownUserIds);
  if (seeded) {
    const persist = db.transaction((events) => {
      for (const event of events) {
        saveEvent(db, event);
      }
    });
    persist(seeded);
  }
}

export function eventsForUser(events, userId) {
  return events.filter((event) => isParticipant(event, userId));
}

export function createEvent({ title, createdBy, inviteeIds, knownUserIds }) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) {
    throw new Error("title is required");
  }
  const id = `evt-${Date.now()}`;
  const invitees = [...new Set((inviteeIds ?? []).map((item) => String(item).trim().toLowerCase()))]
    .filter((userId) => userId && userId !== createdBy)
    .filter((userId) => {
      if (knownUserIds) {
        return knownUserIds.has(userId);
      }
      return isEmail(userId);
    });
  return {
    id,
    title: trimmed,
    createdBy,
    inviteeIds: invitees,
    invites: simulateInvites(id, invitees),
    status: "open",
    finalSlotId: null,
    slots: [],
    votes: [],
  };
}

export function addSlot(event, { date, start, suggestedBy }) {
  if (event.status !== "open") {
    throw Object.assign(new Error("event is final"), { status: 409 });
  }
  const slotDate = String(date ?? "").trim();
  const slotStart = String(start ?? "").trim();
  if (!isIsoDate(slotDate)) {
    throw new Error("date must be YYYY-MM-DD");
  }
  if (!isSlotStart(slotStart)) {
    throw new Error("start must be HH:00 between 06:00 and 22:00");
  }
  if (event.slots.some((slot) => slot.date === slotDate && slot.start === slotStart)) {
    throw new Error("that slot already exists");
  }
  event.slots.push({
    id: `s-${Date.now()}`,
    date: slotDate,
    start: slotStart,
    suggestedBy,
  });
  return event;
}

export function toggleVote(event, { slotId, userId }) {
  if (event.status !== "open") {
    throw Object.assign(new Error("event is final"), { status: 409 });
  }
  if (!event.slots.some((slot) => slot.id === slotId)) {
    throw Object.assign(new Error("slot not found"), { status: 404 });
  }
  const index = event.votes.findIndex((vote) => vote.slotId === slotId && vote.userId === userId);
  if (index >= 0) {
    event.votes.splice(index, 1);
  } else {
    event.votes.push({ slotId, userId });
  }
  return event;
}

export function lockSlot(event, { slotId, userId }) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can lock"), { status: 403 });
  }
  if (event.status !== "open") {
    throw Object.assign(new Error("event is final"), { status: 409 });
  }
  if (!event.slots.some((slot) => slot.id === slotId)) {
    throw Object.assign(new Error("slot not found"), { status: 404 });
  }
  event.status = "final";
  event.finalSlotId = slotId;
  return event;
}
