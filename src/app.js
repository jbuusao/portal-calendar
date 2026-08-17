import path from "node:path";
import express from "express";
import { readUsers, requireUser } from "./auth.js";
import {
  addSlot,
  createEvent,
  eventsForUser,
  isParticipant,
  lockSlot,
  readEvents,
  toggleVote,
  writeEvents,
} from "./events.js";

function httpError(err, fallback = 400) {
  return err?.status ?? fallback;
}

export function createApp({ dataDir, examplePath, configExamplePath, publicDir }) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  const knownIds = () => new Set(readUsers(dataDir, configExamplePath).map((user) => user.id));
  const loadEvents = () => readEvents(dataDir, examplePath, knownIds());
  const save = (events) => {
    writeEvents(dataDir, events);
    return events;
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/users", (_req, res) => {
    try {
      const users = readUsers(dataDir, configExamplePath).map(({ id, name }) => ({ id, name }));
      res.json({ users });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid config" });
    }
  });

  app.get("/api/events", (req, res) => {
    const user = requireUser(req, res, dataDir, configExamplePath);
    if (!user) {
      return;
    }
    try {
      res.json({ events: eventsForUser(loadEvents(), user.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid events" });
    }
  });

  app.post("/api/events", (req, res) => {
    const user = requireUser(req, res, dataDir, configExamplePath);
    if (!user) {
      return;
    }
    try {
      const events = loadEvents();
      const event = createEvent({
        title: req.body?.title,
        createdBy: user.id,
        inviteeIds: req.body?.inviteeIds,
        knownUserIds: knownIds(),
      });
      events.push(event);
      save(events);
      res.status(201).json({ event });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid event" });
    }
  });

  app.get("/api/events/:id", (req, res) => {
    const user = requireUser(req, res, dataDir, configExamplePath);
    if (!user) {
      return;
    }
    try {
      const event = loadEvents().find((item) => item.id === req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      res.json({ event });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid events" });
    }
  });

  app.post("/api/events/:id/slots", (req, res) => {
    const user = requireUser(req, res, dataDir, configExamplePath);
    if (!user) {
      return;
    }
    try {
      const events = loadEvents();
      const event = events.find((item) => item.id === req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      addSlot(event, { date: req.body?.date, start: req.body?.start, suggestedBy: user.id });
      save(events);
      res.status(201).json({ event });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "invalid slot" });
    }
  });

  app.post("/api/events/:id/slots/:slotId/vote", (req, res) => {
    const user = requireUser(req, res, dataDir, configExamplePath);
    if (!user) {
      return;
    }
    try {
      const events = loadEvents();
      const event = events.find((item) => item.id === req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      toggleVote(event, { slotId: req.params.slotId, userId: user.id });
      save(events);
      res.json({ event });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "invalid vote" });
    }
  });

  app.post("/api/events/:id/lock", (req, res) => {
    const user = requireUser(req, res, dataDir, configExamplePath);
    if (!user) {
      return;
    }
    try {
      const events = loadEvents();
      const event = events.find((item) => item.id === req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      lockSlot(event, { slotId: req.body?.slotId, userId: user.id });
      save(events);
      res.json({ event });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not lock" });
    }
  });

  app.use(express.static(publicDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
