const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_START = 6;
const HOUR_COUNT = 17;
const HOURS = Array.from({ length: HOUR_COUNT }, (_, i) => `${String(i + HOUR_START).padStart(2, "0")}:00`);
const GRID_START_MIN = HOUR_START * 60;
const GRID_SPAN_MIN = HOUR_COUNT * 60;
const DEFAULT_HOUR = "18:00";
const DEFAULT_DURATION = 60;
const USER_KEY = "calendar-test-user";
const VIEW_KEY = "calendar-view";
const VIEWS = ["day", "week", "month"];
const VIEW_LABELS = { day: "Day", week: "Week", month: "Month" };

const userSelect = document.getElementById("user-select");
const userSwitcher = document.getElementById("user-switcher");
const signedIn = document.getElementById("signed-in");
const inviteeFieldset = document.getElementById("invitee-fieldset");
const emailInviteLabel = document.getElementById("email-invite-label");
const inviteEmails = document.getElementById("invite-emails");
const inviteEmailAdd = document.getElementById("invite-email-add");
const inviteContactFilter = document.getElementById("invite-contact-filter");
const contactsToggle = document.getElementById("contacts-toggle");
const contactsDialog = document.getElementById("contacts-dialog");
const contactsClose = document.getElementById("contacts-close");
const contactsCount = document.getElementById("contacts-count");
const contactsSearch = document.getElementById("contacts-search");
const contactsList = document.getElementById("contacts-list");
const contactAdd = document.getElementById("contact-add");
const contactFormDialog = document.getElementById("contact-form-dialog");
const contactForm = document.getElementById("contact-form");
const contactFormTitle = document.getElementById("contact-form-title");
const contactFirstName = document.getElementById("contact-first-name");
const contactLastName = document.getElementById("contact-last-name");
const contactNickname = document.getElementById("contact-nickname");
const contactPicture = document.getElementById("contact-picture");
const contactFormError = document.getElementById("contact-form-error");
const contactDelete = document.getElementById("contact-delete");
const contactFormCancel = document.getElementById("contact-form-cancel");
const contactEmailInputs = [0, 1, 2, 3].map((index) => document.getElementById(`contact-email-${index}`));
const calendarNav = document.getElementById("calendar-nav");
const eventList = document.getElementById("event-list");
const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancel = document.getElementById("create-cancel");
const eventFormTitle = document.getElementById("event-form-title");
const eventFormSubmit = document.getElementById("event-form-submit");
const eventSlotFields = document.getElementById("event-slot-fields");
const inviteeLegend = document.getElementById("invitee-legend");
const deleteDialog = document.getElementById("delete-dialog");
const deleteDialogText = document.getElementById("delete-dialog-text");
const deleteNotify = document.getElementById("delete-notify");
const deleteQuiet = document.getElementById("delete-quiet");
const deleteAbort = document.getElementById("delete-abort");
const nameInput = document.getElementById("event-name");
const descriptionInput = document.getElementById("event-description");
const venueInput = document.getElementById("event-venue");
const dateInput = document.getElementById("event-date");
const startInput = document.getElementById("event-start");
const durationInput = document.getElementById("event-duration");
const endInput = document.getElementById("event-end");
const inviteeOptions = document.getElementById("invitee-options");
const monthLabel = document.getElementById("month-label");
const eventTitleLabel = document.getElementById("event-title-label");
const eventsToggle = document.getElementById("events-toggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const sidebarClose = document.getElementById("sidebar-close");
const eventDetail = document.getElementById("event-detail");
const viewMenuBtn = document.getElementById("view-menu-btn");
const viewMenu = document.getElementById("view-menu");
const viewMenuLabel = document.getElementById("view-menu-label");
const grid = document.getElementById("grid");
const lockBtn = document.getElementById("lock-btn");
const todayBtn = document.getElementById("today-btn");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");
const errorBanner = document.getElementById("error-banner");
const dayMenu = document.getElementById("day-menu");
const menuCreateEvent = document.getElementById("menu-create-event");
const menuAddSlot = document.getElementById("menu-add-slot");
const menuDeleteSlot = document.getElementById("menu-delete-slot");
const menuDeleteEvent = document.getElementById("menu-delete-event");
const menuToggleSlotSep = document.getElementById("menu-toggle-slot-sep");
const menuToggleSlot = document.getElementById("menu-toggle-slot");
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

const now = new Date();
let users = [];
let contacts = [];
let maxContacts = 100;
let editingContactId = null;
let events = [];
let currentUserId = localStorage.getItem(USER_KEY) || "";
let sessionUser = null;
let canSwitchUser = true;
let inviteMode = "directory";
let currentEvent = null;
let selectedSlotId = null;
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let selectedDate = toIsoDate(now);
let menuDate = selectedDate;
let menuHour = DEFAULT_HOUR;
let menuSlot = null;
let pendingDeleteId = null;
let pendingTypedEmails = new Set();
let lockedInviteeIds = new Set();
let eventEditorMode = "create";
const storedView = localStorage.getItem(VIEW_KEY);
let calendarView = VIEWS.includes(storedView) ? storedView : "month";

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function weekCells(fromDate) {
  const start = startOfWeek(fromDate instanceof Date ? fromDate : parseIsoDate(fromDate));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

function viewTitle() {
  if (calendarView === "day") {
    return parseIsoDate(selectedDate).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (calendarView === "week") {
    const days = weekCells(selectedDate);
    const start = days[0];
    const end = days[6];
    const startMonth = start.toLocaleString("en-GB", { month: "long" });
    const endMonth = end.toLocaleString("en-GB", { month: "long" });
    if (start.getFullYear() === end.getFullYear()) {
      if (start.getMonth() === end.getMonth()) {
        return `${startMonth} ${start.getFullYear()}`;
      }
      return `${startMonth} – ${endMonth} ${end.getFullYear()}`;
    }
    return `${startMonth} ${start.getFullYear()} – ${endMonth} ${end.getFullYear()}`;
  }
  return monthTitle(viewYear, viewMonth);
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.toggle("hidden", !message);
}

function eventName(event) {
  return event?.name || event?.title || "";
}

function participantIds(event) {
  const inviteeIds = event.inviteeIds ?? event.invitees?.map((item) => item.userId) ?? [];
  return [...new Set([event.createdBy, ...inviteeIds])];
}

function participantsOf(event) {
  if (Array.isArray(event?.participants) && event.participants.length) {
    return event.participants;
  }
  return [
    { userId: event.createdBy, status: event.creatorStatus === "accepted" ? "accepted" : "invited", role: "creator" },
    ...(event.invitees ?? []).map((item) => ({
      userId: item.userId,
      status: item.status,
      role: "invitee",
    })),
  ];
}

function slotDurationMinutes(event, slot) {
  if (slot?.end) {
    let minutes = timeToMinutes(slot.end) - timeToMinutes(slot.start);
    if (minutes <= 0) {
      minutes += 24 * 60;
    }
    return minutes;
  }
  return Number(event?.durationMinutes) || DEFAULT_DURATION;
}

function timedSlotMetrics(event, slot) {
  const startMin = timeToMinutes(slot.start);
  const endMin = startMin + slotDurationMinutes(event, slot);
  const visStart = Math.max(startMin, GRID_START_MIN);
  const visEnd = Math.min(endMin, GRID_START_MIN + GRID_SPAN_MIN);
  if (visEnd <= visStart) {
    return null;
  }
  return {
    startMin: visStart,
    endMin: visEnd,
    top: ((visStart - GRID_START_MIN) / GRID_SPAN_MIN) * 100,
    height: ((visEnd - visStart) / GRID_SPAN_MIN) * 100,
  };
}

function layoutTimedSlots(items) {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin || eventName(a.event).localeCompare(eventName(b.event)),
  );
  const clusters = [];
  let cluster = [];
  let clusterEnd = -1;
  for (const item of sorted) {
    if (cluster.length && item.startMin >= clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) {
    clusters.push(cluster);
  }
  for (const group of clusters) {
    const colEnds = [];
    for (const item of group) {
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col < 0) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      item.col = col;
    }
    const colCount = colEnds.length;
    for (const item of group) {
      item.colCount = colCount;
      item.leftPct = (item.col / colCount) * 100;
      item.widthPct = (1 / colCount) * 100;
    }
  }
  return sorted;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function slotEnd(start, durationMinutes = DEFAULT_DURATION) {
  const total = (timeToMinutes(start) + durationMinutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function slotRange(slot, durationMinutes = DEFAULT_DURATION) {
  if (slot?.end) {
    return `${slot.start}–${slot.end}`;
  }
  return `${slot.start}–${slotEnd(slot.start, durationMinutes)}`;
}

function formatDuration(minutes) {
  const value = Number(minutes) || DEFAULT_DURATION;
  if (value < 60) {
    return `${value} min`;
  }
  const hours = value / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function fillStartOptions() {
  startInput.replaceChildren();
  for (const hour of HOURS) {
    const option = document.createElement("option");
    option.value = hour;
    option.textContent = hour;
    startInput.append(option);
  }
}

function updateEndField() {
  endInput.value = slotEnd(startInput.value || DEFAULT_HOUR, Number(durationInput.value) || DEFAULT_DURATION);
}

function isNarrow() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
  eventsToggle.setAttribute("aria-expanded", "true");
  sidebar.setAttribute("aria-hidden", "false");
  sidebarBackdrop.classList.remove("hidden");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  eventsToggle.setAttribute("aria-expanded", "false");
  if (isNarrow()) {
    sidebar.setAttribute("aria-hidden", "true");
  } else {
    sidebar.removeAttribute("aria-hidden");
  }
  sidebarBackdrop.classList.add("hidden");
}

function toggleSidebar() {
  if (document.body.classList.contains("sidebar-open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function isProposed(event) {
  return event?.status === "proposed";
}

function isPastDate(isoDate) {
  return isoDate < toIsoDate(now);
}

function isPastSlot(date, start) {
  if (isPastDate(date)) {
    return true;
  }
  if (date > toIsoDate(now)) {
    return false;
  }
  const [hour, minute] = String(start).split(":").map(Number);
  const slot = parseIsoDate(date);
  slot.setHours(hour, minute || 0, 0, 0);
  return slot.getTime() <= now.getTime();
}

function slotHasVotes(event, slotId) {
  return Boolean(event?.votes?.some((vote) => vote.slotId === slotId));
}

function votedOnSlot(event, slotId) {
  return personVotedOnSlot(event, currentUserId, slotId);
}

function personVotedOnSlot(event, userId, slotId) {
  return Boolean(
    event?.votes?.some((vote) => vote.slotId === slotId && (vote.userId === userId || (isMe(userId) && isMe(vote.userId)))),
  );
}

function isEventParticipant(event) {
  return participantIds(event).some((id) => isMe(id));
}

function canToggleSlot(event) {
  return Boolean(event && isProposed(event) && isEventParticipant(event));
}

async function toggleSlotVote(event, slot) {
  if (!canToggleSlot(event) || !slot?.id) {
    return;
  }
  showError("");
  const data = await api(`./api/events/${event.id}/slots/${slot.id}/vote`, { method: "POST" });
  replaceEvent(data.event);
}

function visibleSlots(event) {
  if (!event) {
    return [];
  }
  if (isProposed(event)) {
    return event.slots;
  }
  return event.slots.filter((slot) => slot.id === event.confirmedSlotId);
}

function myIds() {
  const ids = new Set([currentUserId].filter(Boolean));
  if (sessionUser?.email) {
    ids.add(sessionUser.email);
  }
  const directory = users.find((user) => user.id === currentUserId);
  if (directory?.email) {
    ids.add(directory.email);
  }
  return ids;
}

function isMe(userId) {
  return myIds().has(userId);
}

function personNameFromContact(contact) {
  if (!contact) {
    return "";
  }
  const nick = String(contact.nickname || "").trim();
  if (nick) {
    return nick;
  }
  return [contact.firstName, contact.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function contactForPerson(id, person = null) {
  const needle = String(id || person?.userId || "").trim().toLowerCase();
  if (!needle) {
    return null;
  }
  const directory = users.find(
    (user) => user.id === id || String(user.id).toLowerCase() === needle || String(user.email || "").toLowerCase() === needle,
  );
  const keys = new Set(
    [needle, id, person?.userId, person?.email, directory?.id, directory?.email]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase()),
  );
  const exact = contacts.find((contact) => contact.emails.some((email) => keys.has(String(email).toLowerCase())));
  if (exact) {
    return exact;
  }
  if (!needle.includes("@")) {
    return (
      contacts.find((contact) => contact.emails.some((email) => String(email).toLowerCase().split("@")[0] === needle)) ??
      null
    );
  }
  return null;
}

function personFace(person) {
  const contact = contactForPerson(person?.userId, person);
  const self = isMe(person?.userId) ? sessionUser : null;
  return {
    firstName: contact?.firstName || person?.firstName || self?.firstName || self?.givenName || "",
    lastName: contact?.lastName || person?.lastName || self?.lastName || self?.familyName || "",
    nickname: contact?.nickname || "",
    picture: String(contact?.picture || person?.picture || self?.picture || "").trim(),
    displayName: userName(person?.userId),
  };
}

function userName(id) {
  const fromEvent = currentEvent && participantsOf(currentEvent).find((item) => item.userId === id)?.name;
  if (fromEvent && !looksLikeEmail(fromEvent)) {
    return fromEvent;
  }
  const named = personNameFromContact(contactForPerson(id));
  if (named) {
    return named;
  }
  if (fromEvent) {
    return fromEvent;
  }
  if (isMe(id) && sessionUser) {
    const mine =
      personNameFromContact({
        firstName: sessionUser.firstName || sessionUser.givenName,
        lastName: sessionUser.lastName || sessionUser.familyName,
        nickname: "",
      }) || (sessionUser.name && !looksLikeEmail(sessionUser.name) ? sessionUser.name : "");
    if (mine) {
      return mine;
    }
  }
  const fromParticipant = currentEvent && participantsOf(currentEvent).find((item) => item.userId === id);
  const participantName = personNameFromContact({
    firstName: fromParticipant?.firstName,
    lastName: fromParticipant?.lastName,
    nickname: "",
  });
  if (participantName) {
    return participantName;
  }
  const directory = users.find((user) => user.id === id || user.email === id);
  if (directory) {
    const full = personNameFromContact(directory);
    if (full) {
      return full;
    }
    if (directory.name && !looksLikeEmail(directory.name)) {
      return directory.name;
    }
  }
  return id;
}

function contactMatches(contact, query) {
  const hay = [contact.displayName, contact.firstName, contact.lastName, contact.nickname, ...contact.emails]
    .join(" ")
    .toLowerCase();
  return hay.includes(String(query || "").trim().toLowerCase());
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (canSwitchUser && currentUserId) {
    headers["X-Test-User"] = currentUserId;
  }
  if (opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(new URL(path, `${location.origin}/`).toString(), { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function applyChrome(session) {
  canSwitchUser = Boolean(session?.canSwitchUser);
  inviteMode = session?.inviteMode === "email" ? "email" : "directory";
  if (session?.maxContacts) {
    maxContacts = Number(session.maxContacts) || maxContacts;
  }
  if (session?.user) {
    currentUserId = session.user.id;
    sessionUser = session.user;
  }
  userSwitcher.classList.toggle("hidden", !canSwitchUser);
  signedIn.classList.toggle("hidden", canSwitchUser || !session?.user);
  signedIn.replaceChildren();
  if (session?.user) {
    appendAvatar(signedIn, session.user, "signed-in-avatar");
    const label = document.createElement("span");
    label.textContent = personNameFromContact({
      firstName: session.user.firstName || session.user.givenName,
      lastName: session.user.lastName || session.user.familyName,
      nickname: "",
    }) || session.user.name;
    signedIn.append(label);
  }
  inviteeFieldset.classList.remove("hidden");
  emailInviteLabel.classList.remove("hidden");
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function addTypedEmail(raw) {
  const emails = String(raw ?? "")
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) {
    return 0;
  }
  let added = 0;
  for (const email of emails) {
    if (!looksLikeEmail(email)) {
      showError("enter a valid email address");
      return added;
    }
    pendingTypedEmails.add(email);
    added += 1;
  }
  showError("");
  renderInviteeOptions();
  return added;
}

function collectCreateInviteeIds() {
  const fromChecks = [...inviteeOptions.querySelectorAll("input:checked")].map((input) => input.value);
  const fromField = inviteEmails.value
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(looksLikeEmail);
  const fromSearch = looksLikeEmail(inviteContactFilter.value) ? [inviteContactFilter.value.trim().toLowerCase()] : [];
  return [...new Set([...fromChecks, ...pendingTypedEmails, ...fromField, ...fromSearch, ...lockedInviteeIds])];
}

function renderInviteeOptions() {
  const checked = new Set([...inviteeOptions.querySelectorAll("input:checked")].map((input) => input.value));
  inviteeOptions.replaceChildren();
  const query = inviteContactFilter?.value.trim() ?? "";
  const queryEmail = looksLikeEmail(query) ? query.toLowerCase() : "";
  const visible = contacts.filter((contact) => !query || contactMatches(contact, query));
  const knownEmails = new Set(contacts.flatMap((contact) => contact.emails));

  const rendered = new Set();
  const isLocked = (value, contact) =>
    lockedInviteeIds.has(value) || Boolean(contact?.emails?.some((email) => lockedInviteeIds.has(email)));
  const appendInvitee = (value, labelText, { checkedByDefault = false, typed = false, contact = null } = {}) => {
    if (!value || rendered.has(value)) {
      return;
    }
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "invitee";
    input.value = value;
    const locked = isLocked(value, contact);
    input.checked = locked || checked.has(value) || checkedByDefault || pendingTypedEmails.has(value);
    input.disabled = locked;
    if (locked) {
      input.title = "This person has voted and cannot be removed";
      pendingTypedEmails.add(value);
    }
    if (typed) {
      if (input.checked) {
        pendingTypedEmails.add(value);
      }
      input.addEventListener("change", () => {
        if (input.checked) {
          pendingTypedEmails.add(value);
        } else {
          pendingTypedEmails.delete(value);
        }
      });
    }
    label.append(input, ` ${labelText}`);
    inviteeOptions.append(label);
    rendered.add(value);
  };

  if (queryEmail && ![...pendingTypedEmails].includes(queryEmail) && !visible.some((contact) => contact.emails.includes(queryEmail))) {
    appendInvitee(queryEmail, `Invite ${queryEmail}`, { checkedByDefault: true, typed: true });
  }
  for (const email of pendingTypedEmails) {
    if (knownEmails.has(email) && visible.some((contact) => contact.emails.includes(email))) {
      continue;
    }
    appendInvitee(email, userName(email), { checkedByDefault: true, typed: true });
  }
  for (const contact of visible) {
    appendInvitee(contact.emails[0], personNameFromContact(contact) || contact.displayName, { contact });
  }
  if (!inviteeOptions.childNodes.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = query
      ? "No matching contacts. Enter an email below to invite someone new."
      : "No contacts yet. Type an email below, or open Contacts to add people.";
    inviteeOptions.append(empty);
  }
}

function renderUserSelect() {
  userSelect.replaceChildren();
  for (const user of users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.name;
    userSelect.append(option);
  }
  if (!users.some((user) => user.id === currentUserId)) {
    currentUserId = users[0]?.id ?? "";
    localStorage.setItem(USER_KEY, currentUserId);
  }
  userSelect.value = currentUserId;
}

function renderEventList() {
  eventList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No events yet. Right-click a day to create one.";
    eventList.append(empty);
    return;
  }
  for (const event of events) {
    const item = document.createElement("li");
    item.className = "event-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-item";
    if (event.id === currentEvent?.id) {
      button.classList.add("active");
    }
    const strong = document.createElement("strong");
    strong.textContent = eventName(event);
    const meta = document.createElement("span");
    meta.className = "meta";
    const status = isProposed(event) ? "Proposed" : "Confirmed";
    const accepted = participantsOf(event).filter((item) => item.status === "accepted").length;
    const pending = participantsOf(event).filter((item) => item.role !== "creator" && inviteState(item) === "pending").length;
    meta.textContent = pending
      ? `${status} · ${accepted}/${participantIds(event).length} accepted · ${pending} unsent`
      : `${status} · ${accepted}/${participantIds(event).length} accepted`;
    button.append(strong, meta);
    button.addEventListener("click", () => selectEvent(event.id));
    if (event.createdBy === currentUserId) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "event-delete";
      remove.setAttribute("aria-label", `Delete ${eventName(event)}`);
      remove.textContent = "Delete";
      remove.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openDeleteDialog(event.id);
      });
      item.append(button, remove);
    } else {
      item.append(button);
    }
    eventList.append(item);
  }
}

function inviteState(person) {
  if (person?.status === "accepted") {
    return "accepted";
  }
  if (person?.role === "creator" || !person?.notifiedAt) {
    return "pending";
  }
  return "invited";
}

function inviteStateLabel(state) {
  return { accepted: "Accepted", invited: "Invited", pending: "Pending" }[state] ?? state;
}

function renderEventDetail() {
  eventDetail.replaceChildren();
  if (!currentEvent) {
    return;
  }
  const heading = document.createElement("h2");
  heading.textContent = eventName(currentEvent);
  eventDetail.append(heading);

  if (currentEvent.slots.length) {
    const slotsHeading = document.createElement("h3");
    slotsHeading.textContent = "Times";
    const slotsList = document.createElement("ul");
    slotsList.className = "slot-vote-list";
    const total = participantIds(currentEvent).length;
    for (const slot of currentEvent.slots) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "slot-vote-item";
      if (slot.id === selectedSlotId) {
        row.classList.add("selected");
      }
      if (votedOnSlot(currentEvent, slot.id)) {
        row.classList.add("mine");
      }
      const when = document.createElement("span");
      when.className = "slot-vote-when";
      when.textContent = `${slot.date} ${slotRange(slot, currentEvent.durationMinutes)}`;
      const count = document.createElement("span");
      count.className = "slot-vote-count";
      const votes = voteCount(currentEvent, slot.id);
      count.textContent = votedOnSlot(currentEvent, slot.id) ? `${votes}/${total} · you` : `${votes}/${total}`;
      row.append(when, count);
      row.addEventListener("click", () => {
        selectedSlotId = slot.id;
        renderCalendar();
      });
      const item = document.createElement("li");
      item.append(row);
      slotsList.append(item);
    }
    eventDetail.append(slotsHeading, slotsList);
  }

  const facts = document.createElement("dl");
  facts.className = "event-facts";
  const addFact = (label, value) => {
    if (!value) {
      return;
    }
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    facts.append(dt, dd);
  };
  if (!currentEvent.slots.length) {
    addFact("When", "No times yet");
  }
  addFact("Duration", formatDuration(currentEvent.durationMinutes));
  addFact("Venue", currentEvent.venue);
  addFact("Description", currentEvent.description);
  eventDetail.append(facts);

  const isCreator = currentEvent.createdBy === currentUserId;
  if (isCreator) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "add-btn edit-event-btn";
    editBtn.textContent = "Update event";
    editBtn.addEventListener("click", () => openEditDialog());
    eventDetail.append(editBtn);
  }

  const peopleHeading = document.createElement("h3");
  peopleHeading.textContent = "Participants";
  const list = document.createElement("ul");
  list.className = "participant-list";
  for (const person of participantsOf(currentEvent)) {
    const item = document.createElement("li");
    appendAvatar(item, personFace(person), "participant-avatar");
    const name = document.createElement("span");
    name.className = "participant-name";
    name.textContent = `${userName(person.userId)}${person.role === "creator" ? " (creator)" : ""}`;
    if (selectedSlotId && personVotedOnSlot(currentEvent, person.userId, selectedSlotId)) {
      const voted = document.createElement("span");
      voted.className = "participant-voted";
      voted.title = "In this slot";
      voted.textContent = "In";
      item.append(name, voted);
    } else {
      item.append(name);
    }
    const state = inviteState(person);
    const badge = document.createElement("span");
    badge.className = `participant-status ${state}`;
    badge.textContent = inviteStateLabel(state);
    item.append(badge);
    list.append(item);
  }
  eventDetail.append(peopleHeading, list);

  if (isCreator) {
    const actions = document.createElement("div");
    actions.className = "invite-actions";
    const pending = participantsOf(currentEvent).filter((item) => item.role !== "creator" && inviteState(item) === "pending");
    const notified = participantsOf(currentEvent).filter((item) => item.role !== "creator" && item.notifiedAt);
    if (pending.length) {
      const sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "add-btn";
      sendBtn.textContent = pending.length === 1 ? "Send invitation" : `Send invitations (${pending.length})`;
      sendBtn.addEventListener("click", () => sendInvitations(false));
      actions.append(sendBtn);
    }
    if (notified.length) {
      const updateBtn = document.createElement("button");
      updateBtn.type = "button";
      updateBtn.className = "today-btn";
      updateBtn.textContent = "Update invitations";
      updateBtn.addEventListener("click", () => sendInvitations(true));
      actions.append(updateBtn);
    }
    if (actions.childNodes.length) {
      eventDetail.append(actions);
    }
  }

  const mine = participantsOf(currentEvent).find((item) => isMe(item.userId));
  if (mine && mine.status !== "accepted") {
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "accept-btn";
    accept.textContent = mine.role === "creator" ? "Accept" : "Accept invite";
    accept.addEventListener("click", acceptCurrentEvent);
    eventDetail.append(accept);
  }
}

function voteCount(event, slotId) {
  return event.votes.filter((vote) => vote.slotId === slotId).length;
}

function slotsByDate() {
  const byDate = new Map();
  for (const event of events) {
    for (const slot of visibleSlots(event)) {
      const list = byDate.get(slot.date) ?? [];
      list.push({ event, slot });
      byDate.set(slot.date, list);
    }
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.slot.start.localeCompare(b.slot.start) || eventName(a.event).localeCompare(eventName(b.event)));
  }
  return byDate;
}

function createSlotButton(event, slot, iso, timed = null) {
  const total = participantIds(event).length;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "event";
  const active = event.id === currentEvent?.id;
  button.classList.add(active ? "active" : "muted-event");
  const count = voteCount(event, slot.id);
  if (timed) {
    button.classList.add("timed");
    if (timed.height < 100 / HOUR_COUNT) {
      button.classList.add("short");
    }
    button.style.top = `${timed.top}%`;
    button.style.height = `${timed.height}%`;
    button.style.left = `calc(${timed.leftPct}% + 2px)`;
    button.style.width = `calc(${timed.widthPct}% - 4px)`;
    const title = document.createElement("span");
    title.className = "event-name";
    title.textContent = eventName(event);
    const meta = document.createElement("span");
    meta.className = "event-when";
    meta.textContent = `${slotRange(slot, event.durationMinutes)} · ${count}/${total}`;
    button.append(title, meta);
  } else {
    button.textContent =
      calendarView === "month"
        ? `${slotRange(slot, event.durationMinutes)} ${eventName(event)} · ${count}/${total}`
        : `${eventName(event)} · ${count}/${total}`;
  }
  if (votedOnSlot(event, slot.id)) {
    button.classList.add("mine");
  }
  if (!isProposed(event)) {
    button.classList.add("confirmed-slot");
  }
  if (active && slot.id === selectedSlotId) {
    button.classList.add("selected-slot");
  }
  let ignoreClick = false;
  const openSlotMenu = (x, y) => {
    currentEvent = event;
    selectedSlotId = slot.id;
    openDayMenu(x, y, iso, slot.start, { event, slot });
  };
  button.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    currentEvent = event;
    selectedSlotId = slot.id;
    selectDate(iso);
    if (isProposed(event)) {
      try {
        await toggleSlotVote(event, slot);
      } catch (err) {
        showError(err.message);
      }
    }
    renderCalendar();
  });
  button.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openSlotMenu(ev.clientX, ev.clientY);
  });
  let pressTimer = 0;
  let pressX = 0;
  let pressY = 0;
  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = 0;
    }
  };
  button.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") {
      return;
    }
    ignoreClick = false;
    pressX = ev.clientX;
    pressY = ev.clientY;
    clearPress();
    pressTimer = window.setTimeout(() => {
      pressTimer = 0;
      ignoreClick = true;
      openSlotMenu(pressX, pressY);
    }, LONG_PRESS_MS);
  });
  button.addEventListener("pointermove", (ev) => {
    if (!pressTimer) {
      return;
    }
    if (Math.hypot(ev.clientX - pressX, ev.clientY - pressY) > LONG_PRESS_MOVE_PX) {
      clearPress();
    }
  });
  button.addEventListener("pointerup", clearPress);
  button.addEventListener("pointercancel", clearPress);
  return button;
}

function bindDayMenu(el, iso, hour = DEFAULT_HOUR) {
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDayMenu(event.clientX, event.clientY, iso, hour);
  });
}

function renderMonthGrid() {
  const byDate = slotsByDate();
  const todayIso = toIsoDate(now);
  grid.className = "calendar-grid";
  grid.replaceChildren();
  for (const label of WEEKDAYS) {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = label;
    grid.append(el);
  }
  for (const date of monthCells(viewYear, viewMonth)) {
    const iso = toIsoDate(date);
    const inMonth = date.getMonth() === viewMonth;
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.date = iso;
    if (!inMonth) {
      cell.classList.add("muted");
    }
    if (iso === todayIso) {
      cell.classList.add("today");
    }
    if (iso === selectedDate) {
      cell.classList.add("selected");
    }
    const dayEl = document.createElement("span");
    dayEl.className = "day";
    dayEl.textContent = String(date.getDate());
    cell.append(dayEl);
    for (const { event, slot } of byDate.get(iso) ?? []) {
      cell.append(createSlotButton(event, slot, iso));
    }
    cell.addEventListener("click", () => selectDate(iso, { goToMonth: !inMonth }));
    bindDayMenu(cell, iso);
    grid.append(cell);
  }
}

function renderTimeGrid(days) {
  const byDate = slotsByDate();
  const todayIso = toIsoDate(now);
  grid.className = `time-grid time-grid-${calendarView}`;
  grid.replaceChildren();
  const corner = document.createElement("div");
  corner.className = "time-corner";
  grid.append(corner);
  for (const date of days) {
    const iso = toIsoDate(date);
    const wrap = document.createElement("div");
    wrap.className = "time-weekday";
    wrap.dataset.date = iso;
    if (iso === todayIso) {
      wrap.classList.add("today");
    }
    if (iso === selectedDate) {
      wrap.classList.add("selected");
    }
    const name = document.createElement("div");
    name.className = "time-weekday-name";
    name.textContent = date.toLocaleDateString("en-GB", { weekday: "short" });
    const num = document.createElement("div");
    num.className = "time-weekday-num";
    num.textContent = String(date.getDate());
    wrap.append(name, num);
    wrap.addEventListener("click", () => selectDate(iso, { goToMonth: true }));
    bindDayMenu(wrap, iso);
    grid.append(wrap);
  }
  const hoursCol = document.createElement("div");
  hoursCol.className = "time-hours";
  for (const hour of HOURS) {
    const label = document.createElement("div");
    label.className = "time-hour";
    label.textContent = hour;
    hoursCol.append(label);
  }
  grid.append(hoursCol);
  for (const date of days) {
    const iso = toIsoDate(date);
    const col = document.createElement("div");
    col.className = "time-day-col";
    if (iso === todayIso) {
      col.classList.add("today-col");
    }
    if (iso === selectedDate) {
      col.classList.add("selected");
    }
    const overlay = document.createElement("div");
    overlay.className = "time-day-events";
    const laidOut = layoutTimedSlots(
      (byDate.get(iso) ?? [])
        .map(({ event, slot }) => {
          const metrics = timedSlotMetrics(event, slot);
          return metrics ? { event, slot, ...metrics } : null;
        })
        .filter(Boolean),
    );
    for (const item of laidOut) {
      overlay.append(createSlotButton(item.event, item.slot, iso, item));
    }
    col.append(overlay);
    for (const hour of HOURS) {
      const cell = document.createElement("div");
      cell.className = "time-cell";
      cell.dataset.date = iso;
      cell.dataset.hour = hour;
      if (iso === todayIso) {
        cell.classList.add("today-col");
      }
      if (iso === selectedDate) {
        cell.classList.add("selected");
      }
      cell.addEventListener("click", () => {
        menuHour = hour;
        selectDate(iso);
      });
      bindDayMenu(cell, iso, hour);
      col.append(cell);
    }
    grid.append(col);
  }
}

function renderGrid() {
  if (calendarView === "month") {
    renderMonthGrid();
    return;
  }
  const days = calendarView === "week" ? weekCells(selectedDate) : [parseIsoDate(selectedDate)];
  renderTimeGrid(days);
}

function updateLockButton() {
  const canLock =
    currentEvent &&
    isProposed(currentEvent) &&
    currentEvent.createdBy === currentUserId &&
    selectedSlotId &&
    currentEvent.slots.some((slot) => slot.id === selectedSlotId);
  lockBtn.classList.toggle("hidden", !canLock);
}

function renderCalendar() {
  if (currentEvent) {
    currentEvent = events.find((item) => item.id === currentEvent.id) ?? currentEvent;
  }
  monthLabel.textContent = viewTitle();
  eventTitleLabel.textContent = currentEvent ? eventName(currentEvent) : "";
  updateViewSwitcher();
  renderEventList();
  renderEventDetail();
  renderGrid();
  updateLockButton();
  syncEventUrl();
}

function closeViewMenu() {
  viewMenu.classList.add("hidden");
  viewMenuBtn.setAttribute("aria-expanded", "false");
}

function closeDayMenu() {
  dayMenu.classList.add("hidden");
}

let dayMenuOpenedAt = 0;

function openDayMenu(x, y, iso, hour, slotTarget = null) {
  closeViewMenu();
  menuDate = iso;
  menuHour = hour || DEFAULT_HOUR;
  menuSlot = slotTarget;
  selectedDate = iso;
  const pastDate = isPastDate(iso);
  const pastSlot = isPastSlot(iso, menuHour);
  const canAdd = currentEvent && isProposed(currentEvent) && !pastSlot;
  menuCreateEvent.classList.toggle("hidden", pastDate);
  menuAddSlot.classList.toggle("hidden", !canAdd);
  if (canAdd) {
    menuAddSlot.textContent = `Add proposed slot for ${eventName(currentEvent)}`;
  }
  const canDeleteSlot =
    slotTarget &&
    isProposed(slotTarget.event) &&
    slotTarget.slot.suggestedBy === currentUserId &&
    !slotHasVotes(slotTarget.event, slotTarget.slot.id);
  menuDeleteSlot.classList.toggle("hidden", !canDeleteSlot);
  const eventForDelete = slotTarget?.event ?? currentEvent;
  const canDeleteEvent = eventForDelete && eventForDelete.createdBy === currentUserId;
  menuDeleteEvent.classList.toggle("hidden", !canDeleteEvent);
  if (canDeleteEvent) {
    menuDeleteEvent.textContent = `Delete event ${eventName(eventForDelete)}`;
  }
  const canToggle = Boolean(slotTarget && canToggleSlot(slotTarget.event));
  menuToggleSlot.classList.toggle("hidden", !canToggle);
  if (canToggle) {
    menuToggleSlot.textContent = votedOnSlot(slotTarget.event, slotTarget.slot.id)
      ? "Remove me from this slot"
      : "Add me to this slot";
  }
  const visibleItems = [...dayMenu.querySelectorAll('[role="menuitem"]')].filter(
    (item) => !item.classList.contains("hidden"),
  );
  const otherVisible = visibleItems.some((item) => item !== menuToggleSlot);
  menuToggleSlotSep.classList.toggle("hidden", !(canToggle && otherVisible));
  if (!visibleItems.length) {
    closeDayMenu();
    if (pastDate) {
      showError("cannot create an event in the past");
    } else if (pastSlot) {
      showError("cannot add a slot in the past");
    }
    return;
  }
  showError("");
  dayMenu.classList.remove("hidden");
  dayMenuOpenedAt = Date.now();
  const pad = 8;
  const left = Math.min(x, window.innerWidth - dayMenu.offsetWidth - pad);
  const top = Math.min(y, window.innerHeight - dayMenu.offsetHeight - pad);
  dayMenu.style.left = `${Math.max(pad, left)}px`;
  dayMenu.style.top = `${Math.max(pad, top)}px`;
}

function ensureDurationOption(minutes) {
  const value = String(minutes || DEFAULT_DURATION);
  if (![...durationInput.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatDuration(Number(value));
    durationInput.append(option);
  }
}

function resetEventFormChrome() {
  eventEditorMode = "create";
  lockedInviteeIds = new Set();
  pendingTypedEmails = new Set();
  eventFormTitle.textContent = "Create event";
  eventFormSubmit.textContent = "Create event";
  inviteeLegend.textContent = "Invite from address book";
  eventSlotFields.classList.remove("hidden");
  dateInput.required = true;
  dateInput.disabled = false;
  startInput.disabled = false;
  durationInput.disabled = false;
  endInput.disabled = false;
}

function openCreateDialog() {
  closeDayMenu();
  closeContactsDialog();
  resetEventFormChrome();
  renderInviteeOptions();
  fillStartOptions();
  dateInput.min = toIsoDate(now);
  dateInput.value = menuDate;
  startInput.value = HOURS.includes(menuHour) ? menuHour : DEFAULT_HOUR;
  durationInput.value = String(DEFAULT_DURATION);
  updateEndField();
  createDialog.classList.remove("hidden");
  nameInput.focus();
}

function openEditDialog() {
  if (!currentEvent || currentEvent.createdBy !== currentUserId) {
    return;
  }
  closeDayMenu();
  closeContactsDialog();
  eventEditorMode = "edit";
  eventFormTitle.textContent = "Update event";
  eventFormSubmit.textContent = "Update event";
  inviteeLegend.textContent = "Invitees";
  nameInput.value = eventName(currentEvent);
  descriptionInput.value = currentEvent.description ?? "";
  venueInput.value = currentEvent.venue ?? "";
  const showSlots = currentEvent.slots.length <= 1;
  const canEditSlot = showSlots && isProposed(currentEvent);
  eventSlotFields.classList.toggle("hidden", !showSlots);
  dateInput.required = canEditSlot;
  dateInput.disabled = !canEditSlot;
  startInput.disabled = !canEditSlot;
  durationInput.disabled = !canEditSlot;
  endInput.disabled = !canEditSlot;
  if (showSlots) {
    fillStartOptions();
    const slot = currentEvent.slots[0];
    const today = toIsoDate(now);
    dateInput.min = slot?.date && slot.date < today ? slot.date : today;
    dateInput.value = slot?.date ?? menuDate ?? today;
    startInput.value = slot?.start && HOURS.includes(slot.start) ? slot.start : DEFAULT_HOUR;
    ensureDurationOption(currentEvent.durationMinutes);
    durationInput.value = String(currentEvent.durationMinutes || DEFAULT_DURATION);
    updateEndField();
  }
  lockedInviteeIds = new Set(
    currentEvent.votes.map((vote) => vote.userId).filter((id) => id !== currentEvent.createdBy),
  );
  pendingTypedEmails = new Set(
    participantsOf(currentEvent)
      .filter((item) => item.role !== "creator")
      .map((item) => item.userId),
  );
  inviteEmails.value = "";
  if (inviteContactFilter) {
    inviteContactFilter.value = "";
  }
  renderInviteeOptions();
  createDialog.classList.remove("hidden");
  nameInput.focus();
}

function closeCreateDialog() {
  createDialog.classList.add("hidden");
  resetEventFormChrome();
  nameInput.value = "";
  descriptionInput.value = "";
  venueInput.value = "";
  dateInput.value = "";
  inviteEmails.value = "";
  pendingTypedEmails = new Set();
  if (inviteContactFilter) {
    inviteContactFilter.value = "";
  }
  for (const input of inviteeOptions.querySelectorAll("input")) {
    input.checked = false;
  }
}

function updateViewSwitcher() {
  viewMenuLabel.textContent = VIEW_LABELS[calendarView];
  for (const option of viewMenu.querySelectorAll(".view-option")) {
    const selected = option.dataset.view === calendarView;
    option.classList.toggle("selected", selected);
    option.querySelector(".view-check").textContent = selected ? "✓" : "";
  }
  const period = VIEW_LABELS[calendarView].toLowerCase();
  prevMonthBtn.setAttribute("aria-label", `Previous ${period}`);
  nextMonthBtn.setAttribute("aria-label", `Next ${period}`);
}

function setCalendarView(view) {
  if (!VIEWS.includes(view) || view === calendarView) {
    closeViewMenu();
    return;
  }
  calendarView = view;
  localStorage.setItem(VIEW_KEY, view);
  closeViewMenu();
  const date = parseIsoDate(selectedDate);
  viewYear = date.getFullYear();
  viewMonth = date.getMonth();
  renderCalendar();
}

function shiftPeriod(delta) {
  const date = parseIsoDate(selectedDate);
  if (calendarView === "day") {
    date.setDate(date.getDate() + delta);
  } else if (calendarView === "week") {
    date.setDate(date.getDate() + delta * 7);
  } else {
    date.setMonth(date.getMonth() + delta, 1);
  }
  selectedDate = toIsoDate(date);
  viewYear = date.getFullYear();
  viewMonth = date.getMonth();
  renderCalendar();
}

function selectDate(iso, { goToMonth = false } = {}) {
  selectedDate = iso;
  if (goToMonth) {
    const date = parseIsoDate(iso);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
  }
  renderCalendar();
}

function eventIdFromLocation() {
  const match = String(location.pathname || "").match(/^\/events\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function eventPath(id) {
  return id ? `/events/${encodeURIComponent(id)}` : "/";
}

let keepEventPath = "";

function syncEventUrl() {
  const next = currentEvent ? eventPath(currentEvent.id) : keepEventPath ? eventPath(keepEventPath) : "/";
  if (location.pathname !== next) {
    history.replaceState(null, "", next);
  }
}

function showEvent(id, { reveal = false } = {}) {
  const event = events.find((item) => item.id === id) ?? null;
  currentEvent = event;
  if (!event) {
    return false;
  }
  keepEventPath = "";
  selectedSlotId = event.confirmedSlotId ?? selectedSlotId;
  if (!event.slots.some((slot) => slot.id === selectedSlotId)) {
    selectedSlotId = visibleSlots(event)[0]?.id ?? null;
  }
  if (reveal) {
    const slot = event.slots.find((item) => item.id === selectedSlotId) ?? visibleSlots(event)[0];
    if (slot?.date) {
      selectedDate = slot.date;
      const date = parseIsoDate(slot.date);
      viewYear = date.getFullYear();
      viewMonth = date.getMonth();
    }
    if (isNarrow()) {
      openSidebar();
    }
  }
  return true;
}

function selectEvent(id) {
  showEvent(id, { reveal: true });
  renderCalendar();
}

function applyEventFromLocation() {
  const pathId = eventIdFromLocation();
  if (!pathId) {
    keepEventPath = "";
    if (currentEvent) {
      currentEvent = events.find((item) => item.id === currentEvent.id) ?? null;
    }
    return;
  }
  if (showEvent(pathId, { reveal: true })) {
    showError("");
    return;
  }
  currentEvent = null;
  keepEventPath = pathId;
  showError("event not found");
}

function replaceEvent(updated) {
  events = events.map((item) => (item.id === updated.id ? updated : item));
  if (currentEvent?.id === updated.id) {
    currentEvent = events.find((item) => item.id === updated.id) ?? updated;
  }
}

function goToToday({ pulse = false } = {}) {
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  selectedDate = toIsoDate(now);
  renderCalendar();
  if (!pulse) {
    return;
  }
  for (const el of document.querySelectorAll(".cell.today, .time-weekday.today")) {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }
  document.querySelector(".cell.today, .time-weekday.today")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function loadCalendar() {
  const data = await api("./api/events");
  events = data.events ?? [];
  applyEventFromLocation();
  await loadContacts();
  renderCalendar();
}

async function loadContacts() {
  try {
    const data = await api("./api/contacts");
    contacts = data.contacts ?? [];
    if (data.max) {
      maxContacts = data.max;
    }
  } catch {
    contacts = [];
  }
  renderInviteeOptions();
  renderContactsList();
}

function contactInitials(contact) {
  const first = String(contact.firstName || contact.nickname || contact.displayName || "?").trim().charAt(0) || "?";
  const last = String(contact.lastName || "").trim().charAt(0);
  return `${first}${last}`.toUpperCase();
}

function appendAvatar(parent, contact, className = "contact-avatar") {
  const picture = String(contact?.picture || contact?.avatar || "").trim();
  if (picture) {
    const img = document.createElement("img");
    img.className = className;
    img.src = picture;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = `${className} contact-avatar-fallback`;
      fallback.textContent = contactInitials(contact || {});
      img.replaceWith(fallback);
    });
    parent.append(img);
    return;
  }
  const span = document.createElement("span");
  span.className = `${className} contact-avatar-fallback`;
  span.textContent = contactInitials(contact || {});
  parent.append(span);
}

function renderContactsList() {
  if (!contactsList) {
    return;
  }
  contactsList.replaceChildren();
  const query = contactsSearch?.value ?? "";
  const visible = contacts.filter((contact) => !query || contactMatches(contact, query));
  contactsCount.textContent = `${contacts.length}/${maxContacts} contacts`;
  contactAdd.disabled = contacts.length >= maxContacts;
  if (!contacts.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No contacts yet. Add someone to invite them later.";
    contactsList.append(empty);
    return;
  }
  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No matching contacts.";
    contactsList.append(empty);
    return;
  }
  for (const contact of visible) {
    const item = document.createElement("li");
    item.className = "contact-row";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "contact-main";
    appendAvatar(main, contact);
    const text = document.createElement("span");
    text.className = "contact-text";
    const name = document.createElement("strong");
    name.textContent = contact.displayName;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = contact.emails.join(" · ");
    text.append(name, meta);
    main.append(text);
    main.addEventListener("click", () => openContactForm(contact));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "event-delete";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${contact.displayName}`);
    remove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteContactById(contact.id);
    });
    item.append(main, remove);
    contactsList.append(item);
  }
}

function openContactsDialog() {
  closeCreateDialog();
  closeDeleteDialog();
  closeSidebar();
  renderContactsList();
  contactsDialog.classList.remove("hidden");
  contactsToggle.setAttribute("aria-expanded", "true");
  contactsSearch.focus();
}

function closeContactsDialog() {
  contactsDialog.classList.add("hidden");
  contactsToggle.setAttribute("aria-expanded", "false");
  contactsSearch.value = "";
}

function showContactFormError(message) {
  contactFormError.textContent = message;
  contactFormError.classList.toggle("hidden", !message);
}

function openContactForm(contact = null) {
  editingContactId = contact?.id ?? null;
  contactFormTitle.textContent = contact ? "Edit contact" : "Add contact";
  contactFirstName.value = contact?.firstName ?? "";
  contactLastName.value = contact?.lastName ?? "";
  contactNickname.value = contact?.nickname ?? "";
  contactPicture.value = contact?.picture ?? "";
  contactEmailInputs.forEach((input, index) => {
    input.value = contact?.emails[index] ?? "";
    input.required = index === 0;
  });
  contactDelete.classList.toggle("hidden", !contact);
  contactDelete.textContent = "Delete";
  showContactFormError("");
  contactFormDialog.classList.remove("hidden");
  contactFirstName.focus();
}

function closeContactForm() {
  editingContactId = null;
  contactFormDialog.classList.add("hidden");
  contactForm.reset();
  showContactFormError("");
  contactDelete.textContent = "Delete";
}

async function deleteContactById(id) {
  try {
    showError("");
    await api(`./api/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
    closeContactForm();
    await loadContacts();
    renderCalendar();
  } catch (err) {
    showError(err.message);
    showContactFormError(err.message);
  }
}

async function addProposedSlot(date, start) {
  if (!currentEvent || !isProposed(currentEvent)) {
    return;
  }
  const data = await api(`./api/events/${currentEvent.id}/slots`, {
    method: "POST",
    body: JSON.stringify({ date, start }),
  });
  replaceEvent(data.event);
  selectedSlotId = data.event.slots.at(-1)?.id ?? selectedSlotId;
  renderCalendar();
}

userSelect.addEventListener("change", async () => {
  currentUserId = userSelect.value;
  localStorage.setItem(USER_KEY, currentUserId);
  currentEvent = null;
  selectedSlotId = null;
  showError("");
  const session = await api("./api/session").catch(() => null);
  if (session) {
    applyChrome(session);
  }
  renderInviteeOptions();
  await loadCalendar();
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (eventEditorMode === "edit") {
    await submitEditEvent();
    return;
  }
  const inviteeIds = collectCreateInviteeIds();
  try {
    showError("");
    const data = await api("./api/events", {
      method: "POST",
      body: JSON.stringify({
        name: nameInput.value.trim(),
        description: descriptionInput.value.trim(),
        venue: venueInput.value.trim(),
        durationMinutes: Number(durationInput.value) || DEFAULT_DURATION,
        inviteeIds,
        date: dateInput.value || menuDate,
        start: startInput.value || menuHour,
      }),
    });
    events.push(data.event);
    currentEvent = data.event;
    selectedSlotId = data.event.slots[0]?.id ?? null;
    selectedDate = dateInput.value || menuDate;
    const date = parseIsoDate(menuDate);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
    closeCreateDialog();
    await loadContacts();
    if (isNarrow()) {
      openSidebar();
    }
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
});

async function submitEditEvent() {
  if (!currentEvent) {
    return;
  }
  const inviteeIds = collectCreateInviteeIds().filter((id) => id !== currentEvent.createdBy);
  const body = {
    name: nameInput.value.trim(),
    description: descriptionInput.value.trim(),
    venue: venueInput.value.trim(),
    inviteeIds,
  };
  if (currentEvent.slots.length <= 1 && isProposed(currentEvent)) {
    body.durationMinutes = Number(durationInput.value) || DEFAULT_DURATION;
    body.date = dateInput.value || currentEvent.slots[0]?.date;
    body.start = startInput.value || currentEvent.slots[0]?.start;
  }
  try {
    showError("");
    const data = await api(`./api/events/${currentEvent.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    replaceEvent(data.event);
    closeCreateDialog();
    await loadContacts();
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
}

createCancel.addEventListener("click", () => closeCreateDialog());
createDialog.addEventListener("click", (event) => {
  if (event.target === createDialog) {
    closeCreateDialog();
  }
});
deleteNotify.addEventListener("click", () => {
  if (pendingDeleteId) {
    deleteEventById(pendingDeleteId, { notify: true });
  }
});
deleteQuiet.addEventListener("click", () => {
  if (pendingDeleteId) {
    deleteEventById(pendingDeleteId, { notify: false });
  }
});
deleteAbort.addEventListener("click", () => closeDeleteDialog());
deleteDialog.addEventListener("click", (event) => {
  if (event.target === deleteDialog) {
    closeDeleteDialog();
  }
});
startInput.addEventListener("change", updateEndField);
durationInput.addEventListener("change", updateEndField);
eventsToggle.addEventListener("click", toggleSidebar);
sidebarClose.addEventListener("click", closeSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);
inviteContactFilter.addEventListener("input", renderInviteeOptions);
inviteContactFilter.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  if (addTypedEmail(inviteContactFilter.value)) {
    inviteContactFilter.value = "";
    renderInviteeOptions();
  }
});
inviteEmails.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  if (addTypedEmail(inviteEmails.value)) {
    inviteEmails.value = "";
  }
});
inviteEmailAdd.addEventListener("click", () => {
  const raw = inviteEmails.value.trim() || inviteContactFilter.value.trim();
  if (!raw) {
    showError("enter a valid email address");
    return;
  }
  if (addTypedEmail(raw)) {
    inviteEmails.value = "";
    if (looksLikeEmail(inviteContactFilter.value)) {
      inviteContactFilter.value = "";
    }
  }
});
contactsToggle.addEventListener("click", () => {
  if (contactsDialog.classList.contains("hidden")) {
    openContactsDialog();
  } else {
    closeContactsDialog();
  }
});
contactsClose.addEventListener("click", () => closeContactsDialog());
contactsDialog.addEventListener("click", (event) => {
  if (event.target === contactsDialog) {
    closeContactsDialog();
  }
});
contactsSearch.addEventListener("input", renderContactsList);
contactAdd.addEventListener("click", () => openContactForm());
contactFormCancel.addEventListener("click", () => closeContactForm());
contactFormDialog.addEventListener("click", (event) => {
  if (event.target === contactFormDialog) {
    closeContactForm();
  }
});
contactDelete.addEventListener("click", () => {
  if (!editingContactId) {
    return;
  }
  if (contactDelete.textContent !== "Confirm delete") {
    contactDelete.textContent = "Confirm delete";
    return;
  }
  deleteContactById(editingContactId);
});
contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const emails = contactEmailInputs.map((input) => input.value.trim().toLowerCase()).filter(Boolean);
  const body = {
    firstName: contactFirstName.value.trim(),
    lastName: contactLastName.value.trim(),
    nickname: contactNickname.value.trim(),
    picture: contactPicture.value.trim(),
    emails,
  };
  try {
    showContactFormError("");
    if (editingContactId) {
      await api(`./api/contacts/${encodeURIComponent(editingContactId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    } else {
      await api("./api/contacts", { method: "POST", body: JSON.stringify(body) });
    }
    closeContactForm();
    await loadContacts();
    renderCalendar();
  } catch (err) {
    showContactFormError(err.message);
  }
});

async function sendInvitations(update) {
  if (!currentEvent) {
    return;
  }
  try {
    showError("");
    const data = await api(`./api/events/${currentEvent.id}/invitations`, {
      method: "POST",
      body: JSON.stringify({ update: Boolean(update) }),
    });
    replaceEvent(data.event);
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
}

async function acceptCurrentEvent() {
  if (!currentEvent) {
    return;
  }
  try {
    showError("");
    const data = await api(`./api/events/${currentEvent.id}/accept`, { method: "POST" });
    replaceEvent(data.event);
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
}

menuCreateEvent.addEventListener("click", () => {
  selectedDate = menuDate;
  openCreateDialog();
});

menuAddSlot.addEventListener("click", async () => {
  closeDayMenu();
  try {
    showError("");
    await addProposedSlot(menuDate, menuHour);
  } catch (err) {
    showError(err.message);
  }
});

function closeDeleteDialog() {
  pendingDeleteId = null;
  deleteDialog.classList.add("hidden");
}

function openDeleteDialog(id) {
  closeDayMenu();
  const event = events.find((item) => item.id === id);
  pendingDeleteId = id;
  deleteDialogText.textContent = event
    ? `Delete “${eventName(event)}”? If others have accepted a slot, you can notify them.`
    : "Delete this event? If others have accepted a slot, you can notify them.";
  deleteDialog.classList.remove("hidden");
}

async function deleteEventById(id, { notify = false } = {}) {
  closeDayMenu();
  closeDeleteDialog();
  try {
    showError("");
    await api(`./api/events/${id}`, { method: "DELETE", body: JSON.stringify({ notify }) });
    events = events.filter((item) => item.id !== id);
    if (currentEvent?.id === id) {
      currentEvent = null;
      selectedSlotId = null;
    }
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
}

menuDeleteSlot.addEventListener("click", async () => {
  closeDayMenu();
  if (!menuSlot) {
    return;
  }
  try {
    showError("");
    const data = await api(`./api/events/${menuSlot.event.id}/slots/${menuSlot.slot.id}`, { method: "DELETE" });
    replaceEvent(data.event);
    if (selectedSlotId === menuSlot.slot.id) {
      selectedSlotId = null;
    }
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
});

menuDeleteEvent.addEventListener("click", () => {
  const id = menuSlot?.event.id ?? currentEvent?.id;
  if (id) {
    openDeleteDialog(id);
  }
});

menuToggleSlot.addEventListener("click", async () => {
  closeDayMenu();
  if (!menuSlot) {
    return;
  }
  currentEvent = menuSlot.event;
  selectedSlotId = menuSlot.slot.id;
  try {
    await toggleSlotVote(menuSlot.event, menuSlot.slot);
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
});

lockBtn.addEventListener("click", async () => {
  try {
    showError("");
    const data = await api(`./api/events/${currentEvent.id}/lock`, {
      method: "POST",
      body: JSON.stringify({ slotId: selectedSlotId }),
    });
    replaceEvent(data.event);
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
});

todayBtn.addEventListener("click", () => goToToday({ pulse: true }));
prevMonthBtn.addEventListener("click", () => shiftPeriod(-1));
nextMonthBtn.addEventListener("click", () => shiftPeriod(1));
updateViewSwitcher();

viewMenuBtn.addEventListener("click", () => {
  const willOpen = viewMenu.classList.contains("hidden");
  closeDayMenu();
  if (willOpen) {
    viewMenu.classList.remove("hidden");
    viewMenuBtn.setAttribute("aria-expanded", "true");
  } else {
    closeViewMenu();
  }
});
viewMenu.addEventListener("click", (event) => {
  const option = event.target.closest(".view-option");
  if (option) {
    setCalendarView(option.dataset.view);
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".view-switcher")) {
    closeViewMenu();
  }
  if (Date.now() - dayMenuOpenedAt < 400) {
    return;
  }
  if (!event.target.closest(".day-menu")) {
    closeDayMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeViewMenu();
    closeDayMenu();
    closeCreateDialog();
    closeDeleteDialog();
    closeContactsDialog();
    closeContactForm();
    closeSidebar();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (event.target.closest("input, textarea, select")) {
    return;
  }
  if (calendarNav.classList.contains("hidden")) {
    return;
  }
  const view = { d: "day", w: "week", m: "month" }[event.key.toLowerCase()];
  if (view) {
    event.preventDefault();
    setCalendarView(view);
  }
});

try {
  let session = await api("./api/session").catch(() => null);
  if (session) {
    applyChrome(session);
  }
  if (canSwitchUser) {
    const data = await api("./api/users");
    users = data.users ?? [];
    renderUserSelect();
    renderInviteeOptions();
    if (!session?.user) {
      session = await api("./api/session");
      applyChrome(session);
    }
  }
  await loadCalendar();
} catch (err) {
  showError(err.message);
  renderCalendar();
}

fillStartOptions();
updateEndField();
window.addEventListener("popstate", () => {
  applyEventFromLocation();
  renderCalendar();
});
window.addEventListener("resize", () => {
  if (!isNarrow()) {
    closeSidebar();
  }
});
