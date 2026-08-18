import path from "node:path";
import express from "express";
import { publicUser, requireUser, usersFromConfig } from "./auth.js";
import { createContext } from "./context.js";
import { openDatabase } from "./db.js";
import {
  addSlot,
  createEvent,
  eventsForUser,
  initializeEventsStore,
  isParticipant,
  loadEvent,
  loadEvents,
  lockSlot,
  saveEvent,
  toggleVote,
} from "./events.js";

function httpError(err, fallback = 400) {
  return err?.status ?? fallback;
}

export function createApp({
  dataDir,
  examplePath,
  configExamplePath,
  publicDir,
  context,
  env,
}) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  const ctx =
    context ??
    createContext({
      dataDir,
      configExamplePath,
      env,
    });
  const directoryIds = () =>
    ctx.embedded ? null : new Set(usersFromConfig(ctx.config()).map((user) => user.id));
  const db = openDatabase(dataDir);
  initializeEventsStore(db, {
    dataDir,
    examplePath,
    knownUserIds: directoryIds(),
    seedExample: ctx.standalone,
  });
  app.locals.db = db;

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const user = ctx.user(req);
    res.json({
      mode: ctx.mode,
      user: user ? publicUser(user) : null,
      source: user?.source ?? null,
      canSwitchUser: ctx.standalone,
      inviteMode: ctx.embedded ? "email" : "directory",
    });
  });

  app.get("/api/users", (_req, res) => {
    if (ctx.embedded) {
      res.json({ users: [], inviteMode: "email" });
      return;
    }
    try {
      const users = usersFromConfig(ctx.config()).map(({ id, name, email }) => ({ id, name, email }));
      res.json({ users, inviteMode: "directory" });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid config" });
    }
  });

  app.get("/api/events", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      res.json({ events: eventsForUser(loadEvents(db), user.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid events" });
    }
  });

  app.post("/api/events", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = createEvent({
        title: req.body?.title,
        createdBy: user.id,
        inviteeIds: req.body?.inviteeIds,
        knownUserIds: directoryIds(),
      });
      saveEvent(db, event);
      res.status(201).json({ event });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid event" });
    }
  });

  app.get("/api/events/:id", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
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
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      addSlot(event, { date: req.body?.date, start: req.body?.start, suggestedBy: user.id });
      saveEvent(db, event);
      res.status(201).json({ event });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "invalid slot" });
    }
  });

  app.post("/api/events/:id/slots/:slotId/vote", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      toggleVote(event, { slotId: req.params.slotId, userId: user.id });
      saveEvent(db, event);
      res.json({ event });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "invalid vote" });
    }
  });

  app.post("/api/events/:id/lock", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user.id)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      lockSlot(event, { slotId: req.body?.slotId, userId: user.id });
      saveEvent(db, event);
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
