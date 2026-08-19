import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

function isoDaysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function closeServer(server, app) {
  app?.locals?.stopMailJobs?.();
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  app?.locals?.db?.close();
}

describe("calendar app", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    app = createApp({ dataDir, examplePath, configExamplePath, publicDir });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await closeServer(server, app);
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

  it("seeds sqlite from the example file when the database is empty", async () => {
    const res = await fetch(`${base}/api/events`, asUser("alice"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].title, "Tennis match");
    assert.equal(body.events[0].name, "Tennis match");
    assert.equal(body.events[0].description, "Weekly doubles");
    assert.equal(body.events[0].venue, "Riverside courts");
    assert.equal(body.events[0].durationMinutes, 60);
    assert.equal(body.events[0].slots[0].end, "19:00");
    assert.equal(body.events[0].status, "proposed");
    assert.equal(body.events[0].inviteeIds[0], "bob");
    assert.equal(body.events[0].invites[0].userId, "bob");
    const alice = body.events[0].participants.find((item) => item.userId === "alice");
    const cara = body.events[0].participants.find((item) => item.userId === "cara");
    const bob = body.events[0].participants.find((item) => item.userId === "bob");
    assert.equal(alice.status, "invited");
    assert.equal(cara.status, "accepted");
    assert.equal(bob.status, "invited");
    assert.equal(existsSync(path.join(dataDir, "calendar.sqlite")), true);
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
    assert.equal(event.status, "proposed");
    assert.deepEqual(event.inviteeIds, ["bob"]);
    assert.equal(event.invites.length, 1);
    assert.equal(event.invites[0].userId, "bob");
    assert.ok(event.invites[0].at);

    const asBob = await fetch(`${base}/api/events`, asUser("bob"));
    const bobBody = await asBob.json();
    assert.ok(bobBody.events.some((item) => item.id === event.id));
    assert.ok(bobBody.events.some((item) => item.title === "Tennis match"));

    const asCara = await fetch(`${base}/api/events`, asUser("cara"));
    const caraBody = await asCara.json();
    assert.equal(
      caraBody.events.some((item) => item.id === event.id),
      false,
    );

    const forbidden = await fetch(`${base}/api/events/${event.id}`, asUser("cara"));
    assert.equal(forbidden.status, 403);
  });

  it("stores name, description, venue, duration, and invite status", async () => {
    const date = isoDaysFromNow(12);
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          name: "Park picnic",
          description: "Bring a blanket",
          venue: "West green",
          date,
          start: "18:00",
          end: "20:00",
          inviteeIds: ["bob"],
        }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.equal(event.name, "Park picnic");
    assert.equal(event.title, "Park picnic");
    assert.equal(event.description, "Bring a blanket");
    assert.equal(event.venue, "West green");
    assert.equal(event.durationMinutes, 120);
    assert.equal(event.slots.length, 1);
    assert.equal(event.slots[0].start, "18:00");
    assert.equal(event.slots[0].end, "20:00");
    assert.equal(event.participants.find((item) => item.userId === "alice").status, "invited");
    assert.equal(event.participants.find((item) => item.userId === "bob").status, "invited");
    assert.equal(event.creatorStatus, "invited");

    const accepted = await fetch(`${base}/api/events/${event.id}/accept`, asUser("bob", { method: "POST" }));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).event.participants.find((item) => item.userId === "bob").status, "accepted");

    const asCara = await fetch(`${base}/api/events/${event.id}/accept`, asUser("cara", { method: "POST" }));
    assert.equal(asCara.status, 403);

    const creatorAccept = await fetch(`${base}/api/events/${event.id}/accept`, asUser("alice", { method: "POST" }));
    assert.equal(creatorAccept.status, 200);
    const afterAccept = await creatorAccept.json();
    assert.equal(afterAccept.event.participants.find((item) => item.userId === "alice").status, "accepted");
    assert.equal(afterAccept.event.creatorStatus, "accepted");
  });

  it("buffers participants until invitations are sent or updated", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Buffered", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    assert.equal(event.participants.find((item) => item.userId === "bob").notifiedAt, "");

    const added = await fetch(
      `${base}/api/events/${event.id}/participants`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ inviteeIds: ["cara"] }),
      }),
    );
    assert.equal(added.status, 201);
    assert.deepEqual((await added.json()).event.inviteeIds.sort(), ["bob", "cara"]);

    const asBobAdd = await fetch(
      `${base}/api/events/${event.id}/participants`,
      asUser("bob", {
        method: "POST",
        body: JSON.stringify({ inviteeIds: ["cara"] }),
      }),
    );
    assert.equal(asBobAdd.status, 403);

    const sent = await fetch(`${base}/api/events/${event.id}/invitations`, asUser("alice", { method: "POST", body: "{}" }));
    assert.equal(sent.status, 200);
    const afterSend = await sent.json();
    assert.equal(afterSend.sent, 2);
    assert.ok(afterSend.event.participants.find((item) => item.userId === "bob").notifiedAt);

    const removed = await fetch(`${base}/api/events/${event.id}/participants/cara`, asUser("alice", { method: "DELETE" }));
    assert.equal(removed.status, 200);
    assert.equal(
      (await removed.json()).event.inviteeIds.includes("cara"),
      false,
    );

    const updated = await fetch(
      `${base}/api/events/${event.id}/invitations`,
      asUser("alice", { method: "POST", body: JSON.stringify({ update: true }) }),
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).sent, 1);
  });

  it("lets the creator update event details and invitees", async () => {
    const date = isoDaysFromNow(11);
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          name: "Draft picnic",
          date,
          start: "18:00",
          durationMinutes: 60,
          inviteeIds: ["bob"],
        }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();

    const asBob = await fetch(
      `${base}/api/events/${event.id}`,
      asUser("bob", { method: "PUT", body: JSON.stringify({ name: "Nope" }) }),
    );
    assert.equal(asBob.status, 403);

    const updated = await fetch(
      `${base}/api/events/${event.id}`,
      asUser("alice", {
        method: "PUT",
        body: JSON.stringify({
          name: "Park picnic",
          description: "Bring a blanket",
          venue: "West green",
          durationMinutes: 90,
          date,
          start: "19:00",
          inviteeIds: ["bob", "cara"],
        }),
      }),
    );
    assert.equal(updated.status, 200);
    const after = await updated.json();
    assert.equal(after.event.name, "Park picnic");
    assert.equal(after.event.description, "Bring a blanket");
    assert.equal(after.event.venue, "West green");
    assert.equal(after.event.durationMinutes, 90);
    assert.equal(after.event.slots[0].start, "19:00");
    assert.equal(after.event.slots[0].end, "20:30");
    assert.deepEqual(after.event.inviteeIds.sort(), ["bob", "cara"]);

    const dropped = await fetch(
      `${base}/api/events/${event.id}`,
      asUser("alice", {
        method: "PUT",
        body: JSON.stringify({ name: "Park picnic", inviteeIds: ["cara"] }),
      }),
    );
    assert.equal(dropped.status, 200);
    assert.deepEqual((await dropped.json()).event.inviteeIds, ["cara"]);

    const secondSlot = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ date: isoDaysFromNow(12), start: "18:00" }),
      }),
    );
    assert.equal(secondSlot.status, 201);
    assert.equal((await secondSlot.json()).event.slots.length, 2);

    const ignoreTimes = await fetch(
      `${base}/api/events/${event.id}`,
      asUser("alice", {
        method: "PUT",
        body: JSON.stringify({
          name: "Park picnic",
          durationMinutes: 30,
          date,
          start: "06:00",
          inviteeIds: ["cara"],
        }),
      }),
    );
    assert.equal(ignoreTimes.status, 200);
    const multi = await ignoreTimes.json();
    assert.equal(multi.event.slots.length, 2);
    assert.equal(multi.event.durationMinutes, 90);
    assert.equal(multi.event.slots[0].start, "19:00");

    const slotId = multi.event.slots[0].id;
    const vote = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("cara", { method: "POST" }));
    assert.equal(vote.status, 200);

    const removeVoter = await fetch(
      `${base}/api/events/${event.id}`,
      asUser("alice", {
        method: "PUT",
        body: JSON.stringify({ name: "Park picnic", inviteeIds: [] }),
      }),
    );
    assert.equal(removeVoter.status, 409);
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
        body: JSON.stringify({ date: isoDaysFromNow(7), start: "18:00" }),
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
    assert.equal(voted.event.participants.find((item) => item.userId === "cara").status, "accepted");
    assert.equal(voted.event.participants.find((item) => item.userId === "bob").status, "accepted");
    assert.equal(voted.event.participants.find((item) => item.userId === "alice").status, "invited");

    const creatorVote = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("alice", { method: "POST" }));
    assert.equal(creatorVote.status, 200);
    assert.equal((await creatorVote.json()).event.participants.find((item) => item.userId === "alice").status, "accepted");

    const again = await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("cara", { method: "POST" }));
    const toggled = await again.json();
    assert.equal(toggled.event.votes.length, 1);
    assert.equal(toggled.event.votes[0].userId, "alice");
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
        body: JSON.stringify({ date: isoDaysFromNow(8), start: "19:00" }),
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
        body: JSON.stringify({ date: isoDaysFromNow(9), start: "17:00" }),
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
    assert.equal(locked.event.status, "confirmed");
    assert.equal(locked.event.confirmedSlotId, slotId);

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
        body: JSON.stringify({ date: isoDaysFromNow(7), start: "18:30" }),
      }),
    );
    assert.equal(res.status, 400);
  });

  it("rejects creating an event or slot in the past", async () => {
    const pastEvent = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Yesterday", inviteeIds: ["bob"], date: "2020-01-01" }),
      }),
    );
    assert.equal(pastEvent.status, 400);

    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Future", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    const pastSlot = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ date: "2020-01-01", start: "18:00" }),
      }),
    );
    assert.equal(pastSlot.status, 400);
  });

  it("lets only the creator delete a voteless slot or event", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Delete me", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    const slotRes = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("bob", {
        method: "POST",
        body: JSON.stringify({ date: isoDaysFromNow(10), start: "18:00" }),
      }),
    );
    const slotId = (await slotRes.json()).event.slots[0].id;

    const asCara = await fetch(`${base}/api/events/${event.id}/slots/${slotId}`, asUser("cara", { method: "DELETE" }));
    assert.equal(asCara.status, 403);

    const asAliceSlot = await fetch(`${base}/api/events/${event.id}/slots/${slotId}`, asUser("alice", { method: "DELETE" }));
    assert.equal(asAliceSlot.status, 403);

    const asBobEvent = await fetch(`${base}/api/events/${event.id}`, asUser("bob", { method: "DELETE" }));
    assert.equal(asBobEvent.status, 403);

    const deletedSlot = await fetch(`${base}/api/events/${event.id}/slots/${slotId}`, asUser("bob", { method: "DELETE" }));
    assert.equal(deletedSlot.status, 200);
    assert.equal((await deletedSlot.json()).event.slots.length, 0);

    const deletedEvent = await fetch(`${base}/api/events/${event.id}`, asUser("alice", { method: "DELETE" }));
    assert.equal(deletedEvent.status, 200);
    const missing = await fetch(`${base}/api/events/${event.id}`, asUser("alice"));
    assert.equal(missing.status, 404);
  });

  it("does not delete a slot that has votes, but the creator can delete the event", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ title: "Voted", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    const slotRes = await fetch(
      `${base}/api/events/${event.id}/slots`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ date: isoDaysFromNow(11), start: "19:00" }),
      }),
    );
    const slotId = (await slotRes.json()).event.slots[0].id;
    await fetch(`${base}/api/events/${event.id}/slots/${slotId}/vote`, asUser("bob", { method: "POST" }));

    const slotDelete = await fetch(`${base}/api/events/${event.id}/slots/${slotId}`, asUser("alice", { method: "DELETE" }));
    assert.equal(slotDelete.status, 409);
    const eventDelete = await fetch(`${base}/api/events/${event.id}`, asUser("alice", { method: "DELETE" }));
    assert.equal(eventDelete.status, 200);
    const missing = await fetch(`${base}/api/events/${event.id}`, asUser("alice"));
    assert.equal(missing.status, 404);
  });

  it("returns a switchable test session", async () => {
    const res = await fetch(`${base}/api/session`, asUser("alice"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      mode: "standalone",
      user: {
        id: "alice",
        name: "Alice",
        email: "alice@example.com",
        givenName: "Alice",
        familyName: "",
        firstName: "Alice",
        lastName: "",
        picture: "",
        login: "alice",
      },
      source: "test",
      canSwitchUser: true,
      inviteMode: "directory",
      maxContacts: 100,
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
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-legacy-"));
    await writeFile(
      path.join(dataDir, "events.json"),
      `${JSON.stringify([{ id: "evt-old", day: 4, title: "Tennis" }], null, 2)}\n`,
    );
    app = createApp({ dataDir, examplePath, configExamplePath, publicDir });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await closeServer(server, app);
    await rm(dataDir, { recursive: true, force: true });
  });

  it("seeds from the example file when events.json has no createdBy", async () => {
    const res = await fetch(`${base}/api/events`, asUser("alice"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].title, "Tennis match");
    assert.equal(body.events[0].createdBy, "alice");
  });
});

describe("events.json import into sqlite", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-import-"));
    await writeFile(
      path.join(dataDir, "events.json"),
      `${JSON.stringify(
        [
          {
            id: "evt-imported",
            title: "Imported match",
            createdBy: "alice",
            inviteeIds: ["bob"],
            invites: [{ eventId: "evt-imported", userId: "bob", at: "2026-08-01T10:00:00.000Z" }],
            status: "open",
            finalSlotId: null,
            slots: [],
            votes: [],
          },
        ],
        null,
        2,
      )}\n`,
    );
    app = createApp({ dataDir, examplePath, configExamplePath, publicDir });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await closeServer(server, app);
    await rm(dataDir, { recursive: true, force: true });
  });

  it("imports a valid events.json into an empty database", async () => {
    const res = await fetch(`${base}/api/events`, asUser("alice"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].id, "evt-imported");
    assert.equal(body.events[0].title, "Imported match");
    assert.equal(body.events[0].status, "proposed");
  });
});

describe("calendar app behind portal identity", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
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
    app = createApp({
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
    await closeServer(server, app);
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
      user: {
        id: "ada@example.com",
        name: "Ada",
        email: "ada@example.com",
        givenName: "Ada",
        familyName: "",
        firstName: "Ada",
        lastName: "",
        picture: "",
        login: "",
      },
      source: "portal",
      canSwitchUser: false,
      inviteMode: "email",
      maxContacts: 100,
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

  it("does not seed the standalone example into an empty embedded database", async () => {
    const res = await fetch(`${base}/api/events`, asPortal("ada@example.com", "Ada"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(
      body.events.some((item) => item.title === "Tennis match"),
      false,
    );
  });
});
