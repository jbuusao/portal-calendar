import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createContext } from "../src/context.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const examplePath = path.join(root, "data", "events.example.json");
const configExamplePath = path.join(root, "data", "config.example.json");
const publicDir = path.join(root, "public");

function asUser(id, init = {}) {
  const headers = { "X-Test-User": id, ...(init.headers ?? {}) };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return { ...init, headers };
}

describe("calendar app", { concurrency: false }, () => {
  let dataDir;
  let server;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    const app = createApp({ dataDir, examplePath, configExamplePath, publicDir });
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

  it("lists test users without a session", async () => {
    const res = await fetch(`${base}/api/users`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.users.length, 3);
    assert.equal(body.users[0].id, "alice");
  });

  it("rejects unknown or missing test users", async () => {
    const missing = await fetch(`${base}/api/events`);
    assert.equal(missing.status, 401);
    const unknown = await fetch(`${base}/api/events`, asUser("not-a-user"));
    assert.equal(unknown.status, 401);
  });

  it("seeds events.json from the example file on first read", async () => {
    const res = await fetch(`${base}/api/events`, asUser("alice"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].title, "Tennis match");
    const stored = JSON.parse(await readFile(path.join(dataDir, "events.json"), "utf8"));
    assert.equal(stored[0].inviteeIds[0], "bob");
    assert.equal(stored[0].invites[0].userId, "bob");
  });

  it("creates an event and simulates invitations", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Evening match", inviteeIds: ["bob"] }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.equal(event.createdBy, "alice");
    assert.deepEqual(event.inviteeIds, ["bob"]);
    assert.equal(event.invites.length, 1);
    assert.equal(event.invites[0].userId, "bob");
    assert.ok(event.invites[0].at);

    const asBob = await fetch(`${base}/api/events`, asUser("bob"));
    const bobBody = await asBob.json();
    assert.ok(bobBody.events.some((item) => item.id === event.id));

    const asCara = await fetch(`${base}/api/events`, asUser("cara"));
    const caraBody = await asCara.json();
    assert.equal(
      caraBody.events.some((item) => item.id === event.id),
      false,
    );

    const forbidden = await fetch(`${base}/api/events/${event.id}`, asUser("cara"));
    assert.equal(forbidden.status, 403);
  });

  it("lets participants suggest slots and toggle votes", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Vote test", inviteeIds: ["bob", "cara"] }),
      }),
    );
    const { event } = await created.json();

    const slotRes = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("bob", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-20", start: "18:00" }),
      }),
    );
    assert.equal(slotRes.status, 201);
    const withSlot = await slotRes.json();
    const slotId = withSlot.event.slots[0].id;

    const vote = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("cara", { method: "POST" }));
    assert.equal(vote.status, 200);
    const voted = await vote.json();
    assert.equal(voted.event.votes.length, 1);
    assert.equal(voted.event.votes[0].userId, "cara");

    const again = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("cara", { method: "POST" }));
    const toggled = await again.json();
    assert.equal(toggled.event.votes.length, 0);
  });

  it("forbids a non-invitee from voting", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Private", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    const slotRes = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-21", start: "19:00" }),
      }),
    );
    const slotId = (await slotRes.json()).event.slots[0].id;
    const vote = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("cara", { method: "POST" }));
    assert.equal(vote.status, 403);
  });

  it("lets the creator lock a slot and then rejects further votes", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Lock test", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    const slotRes = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("bob", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-22", start: "17:00" }),
      }),
    );
    const slotId = (await slotRes.json()).event.slots[0].id;

    const asBobLock = await fetch(
      `${base}/api/events/${event.id}/lock`,
      asUser("bob", { method: "POST", body: JSON.stringify({ slotId }) }),
    );
    assert.equal(asBobLock.status, 403);

    const lock = await fetch(
      `${base}/api/events/${event.id}/lock`,
      asUser("alice", { method: "POST", body: JSON.stringify({ slotId }) }),
    );
    assert.equal(lock.status, 200);
    const locked = await lock.json();
    assert.equal(locked.event.status, "final");
    assert.equal(locked.event.finalSlotId, slotId);

    const vote = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("bob", { method: "POST" }));
    assert.equal(vote.status, 409);
  });

  it("rejects an invalid slot hour", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Bad hour", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    const res = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-20", start: "18:30" }),
      }),
    );
    assert.equal(res.status, 400);
  });

  it("returns a switchable test session", async () => {
    const res = await fetch(`${base}/api/session`, asUser("alice"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      mode: "standalone",
      user: { id: "alice", name: "Alice", email: "alice@example.com" },
      source: "test",
      canSwitchUser: true,
      inviteMode: "directory",
    });
  });

  it("returns a null user when no test header is set", async () => {
    const res = await fetch(`${base}/api/session`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, "standalone");
    assert.equal(body.user, null);
  });
});

describe("legacy dummy events.json", { concurrency: false }, () => {
  let dataDir;
  let server;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-legacy-"));
    await writeFile(
      path.join(dataDir, "events.json"),
      `${JSON.stringify([{ id: "evt-old", day: 4, title: "Tennis" }], null, 2)}\n`,
    );
    const app = createApp({ dataDir, examplePath, configExamplePath, publicDir });
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

  it("reseeds from the example file when createdBy is missing", async () => {
    const res = await fetch(`${base}/api/events`, asUser("alice"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].title, "Tennis match");
    assert.equal(body.events[0].createdBy, "alice");
  });
});

describe("calendar app behind portal identity", { concurrency: false }, () => {
  let dataDir;
  let server;
  let base;

  function asPortal(email, name, init = {}) {
    const headers = {
      "X-Auth-Request-Email": email,
      "X-Auth-Request-User": name,
      ...(init.headers ?? {}),
    };
    if (init.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return { ...init, headers };
  }

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-portal-"));
    const app = createApp({
      dataDir,
      examplePath,
      publicDir,
      context: createContext({ mode: "embedded", slug: "calendar", config: {} }),
    });
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

  it("ignores X-Test-User and exposes a null session without proxy identity", async () => {
    const spoof = await fetch(`${base}/api/events`, asUser("alice"));
    assert.equal(spoof.status, 401);
    const missing = await fetch(`${base}/api/session`);
    assert.equal(missing.status, 200);
    const body = await missing.json();
    assert.equal(body.mode, "embedded");
    assert.equal(body.user, null);
    assert.equal(body.canSwitchUser, false);
  });

  it("uses X-Auth-Request-Email as the user id", async () => {
    const res = await fetch(`${base}/api/session`, asPortal("ada@example.com", "Ada"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      mode: "embedded",
      user: { id: "ada@example.com", name: "Ada", email: "ada@example.com" },
      source: "portal",
      canSwitchUser: false,
      inviteMode: "email",
    });
  });

  it("lets a portal user invite by email", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asPortal("ada@example.com", "Ada", {
        method: "POST",
        body: JSON.stringify({ title: "Portal match", inviteeIds: ["bob@example.com"] }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.equal(event.createdBy, "ada@example.com");
    assert.deepEqual(event.inviteeIds, ["bob@example.com"]);

    const asBob = await fetch(`${base}/api/events`, asPortal("bob@example.com", "Bob"));
    assert.ok((await asBob.json()).events.some((item) => item.id === event.id));

    const asCara = await fetch(`${base}/api/events/${event.id}`, asPortal("cara@example.com", "Cara"));
    assert.equal(asCara.status, 403);
  });
});
