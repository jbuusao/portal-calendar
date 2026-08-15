import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function eventsFile(dataDir) {
  return path.join(dataDir, "events.json");
}

export function ensureEventsFile(dataDir, examplePath) {
  mkdirSync(dataDir, { recursive: true });
  const dest = eventsFile(dataDir);
  if (!existsSync(dest)) {
    copyFileSync(examplePath, dest);
  }
  return dest;
}

export function normalizeEvents(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("events must be an array");
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`events[${index}] is invalid`);
    }
    const day = Number(item.day);
    const title = String(item.title ?? "").trim();
    const id = String(item.id ?? `evt-${index + 1}`);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`events[${index}].day must be 1-31`);
    }
    if (!title) {
      throw new Error(`events[${index}].title is required`);
    }
    return { id, day, title };
  });
}

export function readEvents(dataDir, examplePath) {
  const dest = ensureEventsFile(dataDir, examplePath);
  return normalizeEvents(JSON.parse(readFileSync(dest, "utf8")));
}

export function writeEvents(dataDir, events) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(eventsFile(dataDir), `${JSON.stringify(events, null, 2)}\n`);
}
