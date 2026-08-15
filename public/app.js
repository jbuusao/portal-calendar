const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthLabel = document.getElementById("month-label");
const grid = document.getElementById("grid");
const form = document.getElementById("add-form");
const dayInput = document.getElementById("event-day");
const titleInput = document.getElementById("event-title");

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth();
const today = now.getDate();

monthLabel.textContent = now.toLocaleString("en-GB", { month: "long", year: "numeric" });

function monthCells() {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

async function loadEvents() {
  const res = await fetch("./api/events");
  const data = await res.json();
  return data.events ?? [];
}

async function saveEvents(events) {
  const res = await fetch("./api/events", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not save events");
  }
  return (await res.json()).events;
}

function render(events) {
  const byDay = new Map();
  for (const event of events) {
    const list = byDay.get(event.day) ?? [];
    list.push(event);
    byDay.set(event.day, list);
  }

  grid.replaceChildren();
  for (const label of WEEKDAYS) {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = label;
    grid.append(el);
  }

  for (const date of monthCells()) {
    const inMonth = date.getMonth() === month;
    const day = date.getDate();
    const cell = document.createElement("div");
    cell.className = `cell${inMonth ? "" : " muted"}${inMonth && day === today ? " today" : ""}`;
    const dayEl = document.createElement("span");
    dayEl.className = "day";
    dayEl.textContent = String(day);
    cell.append(dayEl);
    if (inMonth) {
      for (const event of byDay.get(day) ?? []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "event";
        button.textContent = event.title;
        button.title = "Remove event";
        button.addEventListener("click", async () => {
          const next = events.filter((item) => item.id !== event.id);
          render(await saveEvents(next));
        });
        cell.append(button);
      }
    }
    grid.append(cell);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = await loadEvents();
  const next = [
    ...current,
    {
      id: `evt-${Date.now()}`,
      day: Number(dayInput.value),
      title: titleInput.value.trim(),
    },
  ];
  render(await saveEvents(next));
  titleInput.value = "";
});

render(await loadEvents());
