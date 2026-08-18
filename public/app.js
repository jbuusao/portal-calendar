const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MINI_WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const HOURS = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, "0")}:00`);
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
const listHeading = document.getElementById("list-heading");
const calendarNav = document.getElementById("calendar-nav");
const viewList = document.getElementById("view-list");
const viewCalendar = document.getElementById("view-calendar");
const eventList = document.getElementById("event-list");
const createForm = document.getElementById("create-form");
const titleInput = document.getElementById("event-title");
const inviteeOptions = document.getElementById("invitee-options");
const monthLabel = document.getElementById("month-label");
const eventTitleLabel = document.getElementById("event-title-label");
const viewMenuBtn = document.getElementById("view-menu-btn");
const viewMenu = document.getElementById("view-menu");
const viewMenuLabel = document.getElementById("view-menu-label");
const miniMonthLabel = document.getElementById("mini-month-label");
const miniGrid = document.getElementById("mini-grid");
const grid = document.getElementById("grid");
const people = document.getElementById("people");
const suggestForm = document.getElementById("suggest-form");
const selectedDateLabel = document.getElementById("selected-date-label");
const slotHour = document.getElementById("slot-hour");
const lockBtn = document.getElementById("lock-btn");
const todayBtn = document.getElementById("today-btn");
const backBtn = document.getElementById("back-btn");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");
const errorBanner = document.getElementById("error-banner");

const now = new Date();
let users = [];
let currentUserId = localStorage.getItem(USER_KEY) || "";
let canSwitchUser = true;
let inviteMode = "directory";
let currentEvent = null;
let selectedSlotId = null;
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let selectedDate = toIsoDate(now);
const storedView = localStorage.getItem(VIEW_KEY);
let calendarView = VIEWS.includes(storedView) ? storedView : "month";

for (const hour of HOURS) {
  const option = document.createElement("option");
  option.value = hour;
  option.textContent = hour;
  if (hour === "18:00") {
    option.selected = true;
  }
  slotHour.append(option);
}

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

function participantIds(event) {
  return [...new Set([event.createdBy, ...event.inviteeIds])];
}

function userName(id) {
  return users.find((user) => user.id === id)?.name ?? id;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (canSwitchUser && currentUserId) {
    headers["X-Test-User"] = currentUserId;
  }
  if (opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function applyChrome(session) {
  canSwitchUser = Boolean(session?.canSwitchUser);
  inviteMode = session?.inviteMode === "email" ? "email" : "directory";
  if (session?.user) {
    currentUserId = session.user.id;
  }
  userSwitcher.classList.toggle("hidden", !canSwitchUser);
  signedIn.classList.toggle("hidden", canSwitchUser || !session?.user);
  if (session?.user) {
    signedIn.textContent = `Signed in as ${session.user.name}`;
  }
  inviteeFieldset.classList.toggle("hidden", inviteMode !== "directory");
  emailInviteLabel.classList.toggle("hidden", inviteMode !== "email");
}

function showList() {
  currentEvent = null;
  selectedSlotId = null;
  listHeading.classList.remove("hidden");
  calendarNav.classList.add("hidden");
  viewList.classList.remove("hidden");
  viewCalendar.classList.add("hidden");
}

function showCalendar() {
  listHeading.classList.add("hidden");
  calendarNav.classList.remove("hidden");
  viewList.classList.add("hidden");
  viewCalendar.classList.remove("hidden");
}

function renderInviteeOptions() {
  inviteeOptions.replaceChildren();
  for (const user of users) {
    if (user.id === currentUserId) {
      continue;
    }
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "invitee";
    input.value = user.id;
    label.append(input, ` ${user.name}`);
    inviteeOptions.append(label);
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

function renderEventList(events) {
  eventList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("li");
    empty.textContent = "No events yet. Create one and invite participants.";
    eventList.append(empty);
    return;
  }
  for (const event of events) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const count = participantIds(event).length;
    const status = event.status === "final" ? "Final" : "Open";
    const strong = document.createElement("strong");
    strong.textContent = event.title;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${status} · ${count} participants`;
    button.append(strong, meta);
    button.addEventListener("click", () => openEvent(event.id));
    item.append(button);
    eventList.append(item);
  }
}

function renderPeople() {
  const ids = participantIds(currentEvent);
  people.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Participants";
  const list = document.createElement("ul");
  for (const id of ids) {
    const item = document.createElement("li");
    item.textContent = `${userName(id)}${id === currentEvent.createdBy ? " (creator)" : ""}`;
    list.append(item);
  }
  const invited = currentEvent.invites.map((invite) => userName(invite.userId)).join(", ") || "none";
  const simulated = document.createElement("p");
  simulated.className = "sim-invites";
  simulated.textContent = `Invitations (simulated): ${invited}`;
  people.append(heading, list, simulated);
}

function renderMini() {
  miniMonthLabel.textContent = monthTitle(viewYear, viewMonth);
  miniGrid.replaceChildren();
  for (const label of MINI_WEEKDAYS) {
    const el = document.createElement("div");
    el.className = "mini-weekday";
    el.textContent = label;
    miniGrid.append(el);
  }
  const todayIso = toIsoDate(now);
  const weekIsos = calendarView === "month" ? null : new Set(weekCells(selectedDate).map(toIsoDate));
  for (const date of monthCells(viewYear, viewMonth)) {
    const iso = toIsoDate(date);
    const inMonth = date.getMonth() === viewMonth;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-day";
    button.textContent = String(date.getDate());
    button.dataset.date = iso;
    if (!inMonth) {
      button.classList.add("muted");
    }
    if (iso === todayIso) {
      button.classList.add("today");
    }
    if (iso === selectedDate) {
      button.classList.add("selected");
    }
    if (weekIsos?.has(iso)) {
      button.classList.add("in-week");
      if (date.getDay() === 1) {
        button.classList.add("week-start");
      }
      if (date.getDay() === 0) {
        button.classList.add("week-end");
      }
    }
    button.addEventListener("click", () => selectDate(iso, { goToMonth: true }));
    miniGrid.append(button);
  }
}

function voteCount(slotId) {
  return currentEvent.votes.filter((vote) => vote.slotId === slotId).length;
}

function slotsByDate() {
  const byDate = new Map();
  for (const slot of currentEvent.slots) {
    const list = byDate.get(slot.date) ?? [];
    list.push(slot);
    byDate.set(slot.date, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start));
  }
  return byDate;
}

function createSlotButton(slot, iso) {
  const total = participantIds(currentEvent).length;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "event";
  const count = voteCount(slot.id);
  button.textContent = calendarView === "month" ? `${slot.start} · ${count}/${total}` : `${count}/${total}`;
  if (currentEvent.votes.some((vote) => vote.slotId === slot.id && vote.userId === currentUserId)) {
    button.classList.add("mine");
  }
  if (currentEvent.status === "final") {
    if (slot.id === currentEvent.finalSlotId) {
      button.classList.add("final-slot");
    } else {
      button.classList.add("dimmed");
    }
  }
  if (slot.id === selectedSlotId) {
    button.classList.add("selected-slot");
  }
  button.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    selectedSlotId = slot.id;
    selectDate(iso);
    if (currentEvent.status === "open") {
      try {
        showError("");
        const data = await api(`./api/events/${currentEvent.id}/slots/${slot.id}/vote`, { method: "POST" });
        currentEvent = data.event;
      } catch (err) {
        showError(err.message);
      }
    }
    renderCalendar();
  });
  return button;
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
    for (const slot of byDate.get(iso) ?? []) {
      cell.append(createSlotButton(slot, iso));
    }
    cell.addEventListener("click", () => selectDate(iso, { goToMonth: !inMonth }));
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
    grid.append(wrap);
  }
  for (const hour of HOURS) {
    const label = document.createElement("div");
    label.className = "time-hour";
    label.textContent = hour;
    grid.append(label);
    for (const date of days) {
      const iso = toIsoDate(date);
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
      const hourSlots = (byDate.get(iso) ?? []).filter((slot) => slot.start === hour);
      for (const slot of hourSlots) {
        cell.append(createSlotButton(slot, iso));
      }
      cell.addEventListener("click", () => {
        slotHour.value = hour;
        selectDate(iso);
      });
      grid.append(cell);
    }
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
    currentEvent.status === "open" &&
    currentEvent.createdBy === currentUserId &&
    selectedSlotId &&
    currentEvent.slots.some((slot) => slot.id === selectedSlotId);
  lockBtn.classList.toggle("hidden", !canLock);
}

function renderCalendar() {
  monthLabel.textContent = viewTitle();
  eventTitleLabel.textContent = currentEvent.title;
  selectedDateLabel.textContent = parseIsoDate(selectedDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  suggestForm.classList.toggle("hidden", currentEvent.status !== "open");
  updateViewSwitcher();
  renderPeople();
  renderMini();
  renderGrid();
  updateLockButton();
}

function closeViewMenu() {
  viewMenu.classList.add("hidden");
  viewMenuBtn.setAttribute("aria-expanded", "false");
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
  if (currentEvent) {
    renderCalendar();
  } else {
    updateViewSwitcher();
  }
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
  if (currentEvent) {
    renderCalendar();
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
  for (const el of document.querySelectorAll(".cell.today, .mini-day.today, .time-weekday.today")) {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }
  document.querySelector(".cell.today, .time-weekday.today")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function loadList() {
  showList();
  renderInviteeOptions();
  const data = await api("./api/events");
  renderEventList(data.events ?? []);
}

async function openEvent(id) {
  const data = await api(`./api/events/${id}`);
  currentEvent = data.event;
  selectedSlotId = currentEvent.finalSlotId;
  const firstSlot = currentEvent.slots[0];
  if (firstSlot) {
    selectedDate = firstSlot.date;
    const date = parseIsoDate(firstSlot.date);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
  } else {
    goToToday();
  }
  showCalendar();
  renderCalendar();
}

userSelect.addEventListener("change", async () => {
  currentUserId = userSelect.value;
  localStorage.setItem(USER_KEY, currentUserId);
  showError("");
  renderInviteeOptions();
  await loadList();
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const inviteeIds =
    inviteMode === "email"
      ? inviteEmails.value
          .split(/[,;\s]+/)
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
      : [...inviteeOptions.querySelectorAll("input:checked")].map((input) => input.value);
  try {
    showError("");
    await api("./api/events", {
      method: "POST",
      body: JSON.stringify({ title: titleInput.value.trim(), inviteeIds }),
    });
    titleInput.value = "";
    inviteEmails.value = "";
    for (const input of inviteeOptions.querySelectorAll("input")) {
      input.checked = false;
    }
    await loadList();
  } catch (err) {
    showError(err.message);
  }
});

suggestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    showError("");
    const data = await api(`./api/events/${currentEvent.id}/slots`, {
      method: "POST",
      body: JSON.stringify({ date: selectedDate, start: slotHour.value }),
    });
    currentEvent = data.event;
    selectedSlotId = currentEvent.slots.at(-1)?.id ?? selectedSlotId;
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
    currentEvent = data.event;
    renderCalendar();
  } catch (err) {
    showError(err.message);
  }
});

todayBtn.addEventListener("click", () => goToToday({ pulse: true }));
backBtn.addEventListener("click", () => {
  showError("");
  loadList().catch((err) => showError(err.message));
});
prevMonthBtn.addEventListener("click", () => shiftPeriod(-1));
nextMonthBtn.addEventListener("click", () => shiftPeriod(1));
updateViewSwitcher();

viewMenuBtn.addEventListener("click", () => {
  const willOpen = viewMenu.classList.contains("hidden");
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
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeViewMenu();
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
  await loadList();
} catch (err) {
  showError(err.message);
}
