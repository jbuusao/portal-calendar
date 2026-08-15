import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const examplePath = path.join(root, "data", "events.example.json");
const publicDir = path.join(root, "public");

describe("calendar app", () => {
  let dataDir;
  let server;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    const app = createApp({ dataDir, examplePath, publicDir });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reports health", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("seeds events.json from the example file on first read", async () => {
    const res = await fetch(`${base}/api/events`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 3);
    assert.equal(body.events[0].title, "Standup");
    const stored = JSON.parse(await readFile(path.join(dataDir, "events.json"), "utf8"));
    assert.equal(stored[1].title, "Sprint 02 planning");
  });

  it("persists a PUT to events.json", async () => {
    const events = [{ id: "n1", day: 12, title: "Dentist" }];
    const put = await fetch(`${base}/api/events`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    assert.equal(put.status, 200);
    const get = await fetch(`${base}/api/events`);
    assert.deepEqual(await get.json(), { events });
  });

  it("rejects invalid events", async () => {
    const res = await fetch(`${base}/api/events`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ day: 99, title: "Nope" }] }),
    });
    assert.equal(res.status, 400);
  });
});
