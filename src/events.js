import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { simulateInvites } from "./invite.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const START_RE = /^(0[6-9]|1\d|2[0-2]):00$/;
export const DEFAULT_DURATION_MINUTES = 60;

export function isEmail(value) {
  return EMAIL_RE.test(value);
}

export function eventsFile(dataDir) {
  return path.join(dataDir, "events.json");
}

export function newEventId() {
  return randomBytes(4).toString("hex");
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

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isPastDate(isoDate, now = new Date()) {
  return String(isoDate) < toIsoDate(now);
}

export function isPastSlot(date, start, now = new Date()) {
  if (isPastDate(date, now)) {
    return true;
  }
  if (String(date) > toIsoDate(now)) {
    return false;
  }
  const [hour, minute] = String(start).split(":").map(Number);
  const slot = parseIsoDate(date);
  slot.setHours(hour, minute || 0, 0, 0);
  return slot.getTime() <= now.getTime();
}

export function isSlotStart(value) {
  return START_RE.test(value);
}

export function normalizeDuration(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 12 * 60 || minutes % 30 !== 0) {
    return DEFAULT_DURATION_MINUTES;
  }
  return minutes;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

export function slotEnd(start, durationMinutes = DEFAULT_DURATION_MINUTES) {
  const total = (timeToMinutes(start) + durationMinutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function durationFromTimes(start, end) {
  let minutes = timeToMinutes(end) - timeToMinutes(start);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_DURATION_MINUTES;
  }
  return normalizeDuration(Math.round(minutes / 30) * 30);
}

function eventNameOf(raw) {
  return String(raw?.name ?? raw?.title ?? "").trim();
}

function withSlotEnds(slots, durationMinutes) {
  return slots.map((slot) => ({ ...slot, end: slotEnd(slot.start, durationMinutes) }));
}

export function normalizeStatus(value) {
  const status = String(value ?? "").trim();
  if (status === "confirmed" || status === "final") {
    return "confirmed";
  }
  return "proposed";
}

export function isProposed(event) {
  return normalizeStatus(event?.status) === "proposed";
}

export function visibleSlots(event) {
  if (!event) {
    return [];
  }
  if (isProposed(event)) {
    return event.slots;
  }
  return event.slots.filter((slot) => slot.id === event.confirmedSlotId);
}

export function participantIds(event) {
  const inviteeIds = event.inviteeIds ?? event.invitees?.map((item) => item.userId) ?? [];
  return [...new Set([event.createdBy, ...inviteeIds])];
}

function creatorStatusOf(event) {
  if (event?.creatorStatus === "accepted") {
    return "accepted";
  }
  if (event?.votes?.some((vote) => vote.userId === event.createdBy)) {
    return "accepted";
  }
  return "invited";
}

export function serializeEvent(event) {
  const durationMinutes = normalizeDuration(event.durationMinutes);
  const invitees = (Array.isArray(event.invitees) ? event.invitees : []).map((item) => ({
    userId: item.userId,
    status: item.status === "accepted" ? "accepted" : "invited",
    at: item.at || "",
    notifiedAt: item.notifiedAt || "",
  }));
  const inviteeIds = invitees.map((item) => item.userId);
  const slots = withSlotEnds(event.slots ?? [], durationMinutes);
  const name = eventNameOf(event);
  return {
    id: event.id,
    name,
    title: name,
    description: String(event.description ?? "").trim(),
    venue: String(event.venue ?? "").trim(),
    durationMinutes,
    createdBy: event.createdBy,
    creatorStatus: creatorStatusOf(event),
    inviteeIds,
    invitees,
    invites: invitees.map((item) => ({
      eventId: event.id,
      userId: item.userId,
      at: item.at,
      status: item.status,
      notifiedAt: item.notifiedAt || "",
    })),
    participants: [
      { userId: event.createdBy, status: creatorStatusOf(event), role: "creator", notifiedAt: "" },
      ...invitees.map((item) => ({
        userId: item.userId,
        status: item.status,
        at: item.at,
        notifiedAt: item.notifiedAt || "",
        role: "invitee",
      })),
    ],
    status: normalizeStatus(event.status),
    confirmedSlotId: event.confirmedSlotId ?? null,
    slots,
    votes: event.votes ?? [],
  };
}

export function identityKeys(userOrId) {
  if (userOrId == null || userOrId === "") {
    return [];
  }
  if (typeof userOrId === "string") {
    return [userOrId];
  }
  return [...new Set([userOrId.id, userOrId.email].filter(Boolean).map((item) => String(item)))];
}

export function isParticipant(event, userOrId) {
  const ids = new Set(participantIds(event));
  return identityKeys(userOrId).some((key) => ids.has(key));
}

export function participantKey(event, userOrId) {
  const ids = participantIds(event);
  for (const key of identityKeys(userOrId)) {
    if (ids.includes(key)) {
      return key;
    }
  }
  return identityKeys(userOrId)[0] || "";
}

function allowedInvitee(userId, knownUserIds) {
  if (isEmail(userId)) {
    return true;
  }
  return Boolean(knownUserIds && knownUserIds.has(userId));
}

function collectInviteeIds(raw, createdBy, knownUserIds) {
  const fromIds = Array.isArray(raw.inviteeIds) ? raw.inviteeIds : [];
  const fromInvitees = Array.isArray(raw.invitees) ? raw.invitees.map((item) => item?.userId) : [];
  const fromParticipants = Array.isArray(raw.participants)
    ? raw.participants.filter((item) => item?.role !== "creator").map((item) => item?.userId)
    : [];
  return [...new Set([...fromIds, ...fromInvitees, ...fromParticipants].map((item) => String(item ?? "").trim()))]
    .filter((userId) => userId && userId !== createdBy)
    .filter((userId) => !knownUserIds || knownUserIds.has(userId) || isEmail(userId));
}

function normalizeInvitees(raw, eventId, inviteeIds) {
  const fromInvitees = Array.isArray(raw.invitees) ? raw.invitees : [];
  const fromParticipants = Array.isArray(raw.participants)
    ? raw.participants.filter((item) => item && item.userId && item.userId !== raw.createdBy)
    : [];
  const source = fromInvitees.length
    ? fromInvitees
    : fromParticipants.length
      ? fromParticipants
      : Array.isArray(raw.invites)
        ? raw.invites
        : simulateInvites(eventId, inviteeIds);
  return inviteeIds.map((userId) => {
    const existing = source.find((item) => item && (item.userId === userId || item.id === userId));
    const status = existing?.status === "accepted" ? "accepted" : "invited";
    return {
      userId,
      status,
      at: String(existing?.at ?? new Date().toISOString()),
      notifiedAt: String(existing?.notifiedAt ?? existing?.notified_at ?? ""),
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
  const name = eventNameOf(raw);
  const createdBy = String(raw.createdBy ?? "").trim();
  if (!name) {
    throw new Error(`events[${index}].name is required`);
  }
  if (!createdBy || (knownUserIds && !knownUserIds.has(createdBy))) {
    throw new Error(`events[${index}].createdBy is invalid`);
  }
  const inviteeIds = collectInviteeIds(raw, createdBy, knownUserIds);
  const durationMinutes =
    raw.durationMinutes != null || raw.duration != null
      ? normalizeDuration(raw.durationMinutes ?? raw.duration)
      : raw.end
        ? durationFromTimes(raw.slots?.[0]?.start ?? raw.start, raw.end)
        : DEFAULT_DURATION_MINUTES;
  const description = String(raw.description ?? "").trim();
  const venue = String(raw.venue ?? "").trim();
  const status = normalizeStatus(raw.status);
  const slots = withSlotEnds((Array.isArray(raw.slots) ? raw.slots : []).map(normalizeSlot), durationMinutes);
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
  const confirmedRaw = raw.confirmedSlotId ?? raw.finalSlotId;
  let confirmedSlotId = confirmedRaw == null || confirmedRaw === "" ? null : String(confirmedRaw);
  if (status === "confirmed") {
    if (!confirmedSlotId || !slotIds.has(confirmedSlotId)) {
      throw new Error(`events[${index}].confirmedSlotId is required when confirmed`);
    }
  } else {
    confirmedSlotId = null;
  }
  const invitees = normalizeInvitees({ ...raw, createdBy }, id, inviteeIds);
  if (votes.length) {
    for (const invitee of invitees) {
      if (votes.some((vote) => vote.userId === invitee.userId)) {
        invitee.status = "accepted";
      }
    }
  }
  const creatorStatus =
    raw.creatorStatus === "accepted" || votes.some((vote) => vote.userId === createdBy) ? "accepted" : "invited";
  return serializeEvent({
    id,
    name,
    description,
    venue,
    durationMinutes,
    createdBy,
    creatorStatus,
    invitees,
    status,
    confirmedSlotId,
    slots,
    votes,
  });
}

export function normalizeEvents(raw, knownUserIds) {
  if (!Array.isArray(raw)) {
    throw new Error("events must be an array");
  }
  return raw.map((item, index) => normalizeEvent(item, index, knownUserIds));
}

function rowToEvent(db, row) {
  const invitees = db
    .prepare("SELECT user_id, status, at, notified_at FROM invitees WHERE event_id = ? ORDER BY user_id")
    .all(row.id)
    .map((item) => ({
      userId: item.user_id,
      status: item.status === "accepted" ? "accepted" : "invited",
      at: item.at || "",
      notifiedAt: item.notified_at || "",
    }));
  if (!invitees.length) {
    const legacy = db.prepare("SELECT user_id, at FROM invites WHERE event_id = ? ORDER BY user_id").all(row.id);
    for (const item of legacy) {
      invitees.push({ userId: item.user_id, status: "invited", at: item.at || "" });
    }
  }
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
  for (const invitee of invitees) {
    if (votes.some((vote) => vote.userId === invitee.userId)) {
      invitee.status = "accepted";
    }
  }
  return serializeEvent({
    id: row.id,
    name: row.title,
    description: row.description ?? "",
    venue: row.venue ?? "",
    durationMinutes: row.duration_minutes ?? DEFAULT_DURATION_MINUTES,
    createdBy: row.created_by,
    creatorStatus: row.creator_status === "accepted" ? "accepted" : "invited",
    invitees,
    status: normalizeStatus(row.status),
    confirmedSlotId: row.final_slot_id,
    slots,
    votes,
  });
}

const EVENT_COLUMNS = "id, title, created_by, status, final_slot_id, description, venue, duration_minutes, creator_status";

export function loadEvents(db) {
  return db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events ORDER BY id`)
    .all()
    .map((row) => rowToEvent(db, row));
}

export function loadEvent(db, id) {
  const row = db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(id);
  return row ? rowToEvent(db, row) : null;
}

export function allocateEventId(db) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = newEventId();
    if (!loadEvent(db, id)) {
      return id;
    }
  }
  throw new Error("could not allocate event id");
}

export function saveEvent(db, event) {
  const item = serializeEvent(event);
  const persist = db.transaction((record) => {
    db.prepare("DELETE FROM events WHERE id = ?").run(record.id);
    db.prepare(
      "INSERT INTO events (id, title, created_by, status, final_slot_id, description, venue, duration_minutes, creator_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      record.id,
      record.name,
      record.createdBy,
      record.status,
      record.confirmedSlotId,
      record.description,
      record.venue,
      record.durationMinutes,
      record.creatorStatus,
    );
    const insertInvitee = db.prepare(
      "INSERT INTO invitees (event_id, user_id, status, at, notified_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const invitee of record.invitees) {
      insertInvitee.run(record.id, invitee.userId, invitee.status, invitee.at, invitee.notifiedAt || "");
    }
    const insertSlot = db.prepare("INSERT INTO slots (id, event_id, date, start, suggested_by) VALUES (?, ?, ?, ?, ?)");
    for (const slot of record.slots) {
      insertSlot.run(slot.id, record.id, slot.date, slot.start, slot.suggestedBy);
    }
    const insertVote = db.prepare("INSERT INTO votes (slot_id, user_id) VALUES (?, ?)");
    for (const vote of record.votes) {
      insertVote.run(vote.slotId, vote.userId);
    }
  });
  persist(item);
  return item;
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

export function eventsForUser(events, userOrId) {
  return events.filter((event) => isParticipant(event, userOrId));
}

export function createEvent({
  id,
  title,
  name,
  description,
  venue,
  durationMinutes,
  createdBy,
  inviteeIds,
  knownUserIds,
  date,
  start,
  end,
  now = new Date(),
}) {
  const trimmed = eventNameOf({ name, title });
  if (!trimmed) {
    throw new Error("name is required");
  }
  const eventId = String(id ?? "").trim() || newEventId();
  const invitees = [...new Set((inviteeIds ?? []).map((item) => String(item).trim().toLowerCase()))]
    .filter((userId) => userId && userId !== createdBy)
    .filter((userId) => allowedInvitee(userId, knownUserIds))
    .map((userId) => ({ userId, status: "invited", at: now.toISOString(), notifiedAt: "" }));
  if (date != null && String(date).trim()) {
    const iso = String(date).trim();
    if (!isIsoDate(iso)) {
      throw new Error("date must be YYYY-MM-DD");
    }
    if (isPastDate(iso, now)) {
      throw new Error("cannot create an event in the past");
    }
  }
  const event = serializeEvent({
    id: eventId,
    name: trimmed,
    description: String(description ?? "").trim(),
    venue: String(venue ?? "").trim(),
    durationMinutes:
      durationMinutes != null
        ? normalizeDuration(durationMinutes)
        : end && start
          ? durationFromTimes(start, end)
          : DEFAULT_DURATION_MINUTES,
    createdBy,
    creatorStatus: "invited",
    invitees,
    status: "proposed",
    confirmedSlotId: null,
    slots: [],
    votes: [],
  });
  if (date && start) {
    addSlot(event, { date, start, suggestedBy: createdBy });
  }
  return serializeEvent(event);
}

export function updateEvent(event, {
  title,
  name,
  description,
  venue,
  durationMinutes,
  date,
  start,
  inviteeIds,
  knownUserIds,
  userId,
  now = new Date(),
}) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can update this event"), { status: 403 });
  }
  if (name != null || title != null) {
    const trimmed = eventNameOf({ name, title });
    if (!trimmed) {
      throw new Error("name is required");
    }
    event.name = trimmed;
    event.title = trimmed;
  }
  if (description != null) {
    event.description = String(description).trim();
  }
  if (venue != null) {
    event.venue = String(venue).trim();
  }
  const canEditTimes = isProposed(event) && (event.slots?.length ?? 0) <= 1;
  if (canEditTimes && durationMinutes != null) {
    event.durationMinutes = normalizeDuration(durationMinutes);
  }
  if (canEditTimes && (date != null || start != null)) {
    const nextDate = String(date ?? event.slots[0]?.date ?? "").trim();
    const nextStart = String(start ?? event.slots[0]?.start ?? "").trim();
    if (nextDate && nextStart) {
      if (!isIsoDate(nextDate)) {
        throw new Error("date must be YYYY-MM-DD");
      }
      if (!isSlotStart(nextStart)) {
        throw new Error("start must be HH:00 between 06:00 and 22:00");
      }
      const slot = event.slots[0];
      const unchanged = slot && slot.date === nextDate && slot.start === nextStart;
      if (!unchanged && isPastSlot(nextDate, nextStart, now)) {
        throw new Error("cannot add a slot in the past");
      }
      if (!slot) {
        addSlot(event, { date: nextDate, start: nextStart, suggestedBy: userId });
      } else {
        slot.date = nextDate;
        slot.start = nextStart;
      }
    }
  }
  if (inviteeIds != null) {
    syncInvitees(event, { inviteeIds, knownUserIds, userId, now });
  }
  return serializeEvent(event);
}

function syncInvitees(event, { inviteeIds, knownUserIds, userId, now }) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can manage participants"), { status: 403 });
  }
  const desired = [...new Set((inviteeIds ?? []).map((item) => String(item).trim().toLowerCase()))]
    .filter((inviteeId) => inviteeId && inviteeId !== event.createdBy)
    .filter((inviteeId) => allowedInvitee(inviteeId, knownUserIds));
  const desiredSet = new Set(desired);
  const next = [];
  for (const item of event.invitees ?? []) {
    if (desiredSet.has(item.userId)) {
      next.push(item);
      continue;
    }
    if (event.votes?.some((vote) => vote.userId === item.userId)) {
      throw Object.assign(new Error("participant already has votes"), { status: 409 });
    }
  }
  const kept = new Set(next.map((item) => item.userId));
  for (const inviteeId of desired) {
    if (kept.has(inviteeId)) {
      continue;
    }
    next.push({ userId: inviteeId, status: "invited", at: now.toISOString(), notifiedAt: "" });
    kept.add(inviteeId);
  }
  event.invitees = next;
}

export function addSlot(event, { date, start, suggestedBy }) {
  if (!isProposed(event)) {
    throw Object.assign(new Error("event is confirmed"), { status: 409 });
  }
  const slotDate = String(date ?? "").trim();
  const slotStart = String(start ?? "").trim();
  if (!isIsoDate(slotDate)) {
    throw new Error("date must be YYYY-MM-DD");
  }
  if (!isSlotStart(slotStart)) {
    throw new Error("start must be HH:00 between 06:00 and 22:00");
  }
  if (isPastSlot(slotDate, slotStart)) {
    throw new Error("cannot add a slot in the past");
  }
  if (event.slots.some((slot) => slot.date === slotDate && slot.start === slotStart)) {
    throw new Error("that slot already exists");
  }
  event.slots.push({
    id: `s-${Date.now()}`,
    date: slotDate,
    start: slotStart,
    suggestedBy,
    end: slotEnd(slotStart, event.durationMinutes),
  });
  if (suggestedBy !== event.createdBy) {
    acceptInvitee(event, suggestedBy);
  }
  return serializeEvent(event);
}

export function toggleVote(event, { slotId, userId }) {
  if (!isProposed(event)) {
    throw Object.assign(new Error("event is confirmed"), { status: 409 });
  }
  if (!event.slots.some((slot) => slot.id === slotId)) {
    throw Object.assign(new Error("slot not found"), { status: 404 });
  }
  const index = event.votes.findIndex((vote) => vote.slotId === slotId && vote.userId === userId);
  if (index >= 0) {
    event.votes.splice(index, 1);
  } else {
    event.votes.push({ slotId, userId });
    acceptInvitee(event, userId);
  }
  return serializeEvent(event);
}

export function addInvitees(event, { inviteeIds, knownUserIds, userId, now = new Date() }) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can manage participants"), { status: 403 });
  }
  const existing = new Set(participantIds(event));
  const added = [];
  for (const raw of inviteeIds ?? []) {
    const inviteeId = String(raw ?? "").trim().toLowerCase();
    if (!inviteeId || existing.has(inviteeId)) {
      continue;
    }
    if (!allowedInvitee(inviteeId, knownUserIds)) {
      continue;
    }
    added.push({ userId: inviteeId, status: "invited", at: now.toISOString(), notifiedAt: "" });
    existing.add(inviteeId);
  }
  if (!added.length) {
    throw Object.assign(new Error("no new participants to add"), { status: 400 });
  }
  event.invitees = [...(event.invitees ?? []), ...added];
  return serializeEvent(event);
}

export function removeInvitee(event, { inviteeId, userId }) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can manage participants"), { status: 403 });
  }
  const id = String(inviteeId ?? "").trim();
  if (!id || id === event.createdBy) {
    throw Object.assign(new Error("cannot remove the creator"), { status: 400 });
  }
  if (!event.invitees?.some((item) => item.userId === id)) {
    throw Object.assign(new Error("participant not found"), { status: 404 });
  }
  if (event.votes?.some((vote) => vote.userId === id)) {
    throw Object.assign(new Error("participant already has votes"), { status: 409 });
  }
  event.invitees = event.invitees.filter((item) => item.userId !== id);
  return serializeEvent(event);
}

export function markInviteesNotified(event, userIds, at = new Date().toISOString()) {
  const ids = new Set(userIds);
  for (const invitee of event.invitees ?? []) {
    if (ids.has(invitee.userId)) {
      invitee.notifiedAt = at;
    }
  }
  return serializeEvent(event);
}

export function pendingInvitees(event) {
  return (event.invitees ?? []).filter((item) => !item.notifiedAt);
}

export function notifiedInvitees(event) {
  return (event.invitees ?? []).filter((item) => item.notifiedAt);
}

export function cancellationRecipients(event) {
  return (event.invitees ?? []).filter((item) => {
    if (item.userId === event.createdBy) {
      return false;
    }
    return Boolean(item.notifiedAt) || item.status === "accepted" || event.votes?.some((vote) => vote.userId === item.userId);
  });
}

export function acceptInvitee(event, userId) {
  if (!isParticipant(event, userId)) {
    throw Object.assign(new Error("not a participant"), { status: 403 });
  }
  if (userId === event.createdBy) {
    event.creatorStatus = "accepted";
    return serializeEvent(event);
  }
  const invitee = event.invitees?.find((item) => item.userId === userId);
  if (invitee) {
    invitee.status = "accepted";
  }
  return serializeEvent(event);
}

export function lockSlot(event, { slotId, userId }) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can lock"), { status: 403 });
  }
  if (!isProposed(event)) {
    throw Object.assign(new Error("event is confirmed"), { status: 409 });
  }
  if (!event.slots.some((slot) => slot.id === slotId)) {
    throw Object.assign(new Error("slot not found"), { status: 404 });
  }
  event.status = "confirmed";
  event.confirmedSlotId = slotId;
  return serializeEvent(event);
}

export function eventHasVotes(event) {
  return Boolean(event?.votes?.length);
}

export function slotHasVotes(event, slotId) {
  return Boolean(event?.votes?.some((vote) => vote.slotId === slotId));
}

export function deleteSlot(event, { slotId, userId }) {
  if (!isProposed(event)) {
    throw Object.assign(new Error("event is confirmed"), { status: 409 });
  }
  const slot = event.slots.find((item) => item.id === slotId);
  if (!slot) {
    throw Object.assign(new Error("slot not found"), { status: 404 });
  }
  if (slot.suggestedBy !== userId) {
    throw Object.assign(new Error("only the creator can delete"), { status: 403 });
  }
  if (slotHasVotes(event, slotId)) {
    throw Object.assign(new Error("slot already has votes"), { status: 409 });
  }
  event.slots = event.slots.filter((item) => item.id !== slotId);
  return serializeEvent(event);
}

export function deleteStoredEvent(db, event, { userId } = {}) {
  if (event.createdBy !== userId) {
    throw Object.assign(new Error("only the creator can delete"), { status: 403 });
  }
  db.prepare("DELETE FROM events WHERE id = ?").run(event.id);
}
