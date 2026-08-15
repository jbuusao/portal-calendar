import path from "node:path";
import express from "express";
import { normalizeEvents, readEvents, writeEvents } from "./events.js";

export function createApp({ dataDir, examplePath, publicDir }) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: readEvents(dataDir, examplePath) });
  });

  app.put("/api/events", (req, res) => {
    try {
      const events = normalizeEvents(req.body?.events);
      writeEvents(dataDir, events);
      res.json({ events });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid events" });
    }
  });

  app.use(express.static(publicDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
