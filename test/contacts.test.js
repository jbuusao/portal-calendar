import { mkdtemp, rm } from "node:fs/promises";
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

function asPortal(email, name, init = {}, extra = {}) {
  const headers = {
    "X-Auth-Request-Email": email,
    "X-Auth-Request-User": name,
    ...extra,
    ...(init.headers ?? {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return { ...init, headers };
}

async function closeServer(server, app) {
  app?.locals?.stopMailJobs?.();
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  app?.locals?.db?.close();
}

describe("address book", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-contacts-"));
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

  it("lets a user add, edit, and delete contacts", async () => {
    const created = await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Bob",
          lastName: "Neighbor",
          nickname: "Bobby",
          emails: ["bob@example.com", "bob.work@example.com"],
        }),
      }),
    );
    assert.equal(created.status, 201);
    const { contact } = await created.json();
    assert.equal(contact.displayName, "Bobby");
    assert.deepEqual(contact.emails, ["bob@example.com", "bob.work@example.com"]);

    const listed = await fetch(`${base}/api/contacts`, asUser("alice"));
    assert.equal((await listed.json()).contacts.length, 1);

    const asBob = await fetch(`${base}/api/contacts`, asUser("bob"));
    assert.equal((await asBob.json()).contacts.length, 0);

    const updated = await fetch(
      `${base}/api/contacts/${contact.id}`,
      asUser("alice", {
        method: "PUT",
        body: JSON.stringify({ nickname: "Robert", emails: ["bob@example.com"] }),
      }),
    );
    assert.equal(updated.status, 200);
    const saved = await updated.json();
    assert.equal(saved.contact.nickname, "Robert");
    assert.equal(saved.contact.emails.length, 1);

    const deleted = await fetch(`${base}/api/contacts/${contact.id}`, asUser("alice", { method: "DELETE" }));
    assert.equal(deleted.status, 200);
    const empty = await fetch(`${base}/api/contacts`, asUser("alice"));
    assert.equal((await empty.json()).contacts.length, 0);
  });

  it("rejects a fifth email and duplicate emails in the same book", async () => {
    const first = await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ firstName: "Cara", emails: ["cara@example.com"] }),
      }),
    );
    assert.equal(first.status, 201);
    const tooMany = await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Extra",
          emails: ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"],
        }),
      }),
    );
    assert.equal(tooMany.status, 400);
    const dup = await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ firstName: "Also Cara", emails: ["cara@example.com"] }),
      }),
    );
    assert.equal(dup.status, 409);
  });

  it("invites from the address book or a typed email and stores a contact stub", async () => {
    await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ firstName: "Dana", lastName: "Guest", emails: ["dana@example.net"] }),
      }),
    );
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          name: "Mixed invites",
          inviteeIds: ["bob", "dana@example.net", "new.person@example.net"],
        }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.ok(event.inviteeIds.includes("bob"));
    assert.ok(event.inviteeIds.includes("dana@example.net"));
    assert.ok(event.inviteeIds.includes("new.person@example.net"));
    assert.equal(event.participants.find((item) => item.userId === "dana@example.net").name, "Dana Guest");
    assert.equal(
      event.participants.find((item) => item.userId === "new.person@example.net").name,
      "new.person@example.net",
    );

    const book = await fetch(`${base}/api/contacts`, asUser("alice"));
    const emails = (await book.json()).contacts.flatMap((item) => item.emails);
    assert.ok(emails.includes("bob@example.com"));
    assert.ok(emails.includes("new.person@example.net"));
  });

  it("prefers nickname over first and last name on participants", async () => {
    const createdContact = await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Elena",
          lastName: "Rios",
          nickname: "Ellie",
          emails: ["ellie@example.net"],
        }),
      }),
    );
    const { contact } = await createdContact.json();
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Named invitees", inviteeIds: ["ellie@example.net"] }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.equal(event.participants.find((item) => item.userId === "ellie@example.net").name, "Ellie");

    await fetch(
      `${base}/api/contacts/${contact.id}`,
      asUser("alice", {
        method: "PUT",
        body: JSON.stringify({ nickname: "", emails: ["ellie@example.net"] }),
      }),
    );
    const listed = await fetch(`${base}/api/events/${event.id}`, asUser("alice"));
    assert.equal((await listed.json()).event.participants.find((item) => item.userId === "ellie@example.net").name, "Elena Rios");
  });

  it("includes the address-book avatar on event participants", async () => {
    await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Fay",
          lastName: "Cole",
          picture: "https://example.com/fay.png",
          emails: ["fay@example.net"],
        }),
      }),
    );
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Avatar invite", inviteeIds: ["fay@example.net"] }),
      }),
    );
    assert.equal(created.status, 201);
    const fay = (await created.json()).event.participants.find((item) => item.userId === "fay@example.net");
    assert.equal(fay.picture, "https://example.com/fay.png");
    assert.equal(fay.firstName, "Fay");
    assert.equal(fay.lastName, "Cole");
  });

  it("updates a contact when the invitee accepts", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Accept names", inviteeIds: ["bob"] }),
      }),
    );
    const createdBody = await created.json();
    assert.equal(created.status, 201, createdBody.error);
    const { event } = createdBody;
    const before = await fetch(`${base}/api/contacts`, asUser("alice"));
    const bobBefore = (await before.json()).contacts.find((item) => item.emails.includes("bob@example.com"));
    assert.equal(bobBefore.firstName, "");

    const accepted = await fetch(`${base}/api/events/${event.id}/accept`, asUser("bob", { method: "POST" }));
    assert.equal(accepted.status, 200);

    const after = await fetch(`${base}/api/contacts`, asUser("alice"));
    const bobAfter = (await after.json()).contacts.find((item) => item.emails.includes("bob@example.com"));
    assert.equal(bobAfter.firstName, "Bob");
  });
});

describe("address book behind portal identity", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-contacts-portal-"));
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

  it("fills first name, last name, and picture from Context on accept", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asPortal("ada@example.com", "Ada", {
        method: "POST",
        body: JSON.stringify({ name: "OAuth picnic", inviteeIds: ["bob@example.com"] }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();

    const accepted = await fetch(
      `${base}/api/events/${event.id}/accept`,
      asPortal(
        "bob@example.com",
        "Robert Smith",
        { method: "POST" },
        {
          "X-Auth-Request-Given-Name": "Robert",
          "X-Auth-Request-Family-Name": "Smith",
          "X-Auth-Request-Picture": "https://example.com/bob.png",
        },
      ),
    );
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).event.participants.find((item) => item.userId === "bob@example.com").picture, "https://example.com/bob.png");

    const book = await fetch(`${base}/api/contacts`, asPortal("ada@example.com", "Ada"));
    const bob = (await book.json()).contacts.find((item) => item.emails.includes("bob@example.com"));
    assert.equal(bob.firstName, "Robert");
    assert.equal(bob.lastName, "Smith");
    assert.equal(bob.picture, "https://example.com/bob.png");
    assert.equal(bob.displayName, "Robert Smith");

    const named = await fetch(`${base}/api/events/${event.id}`, asPortal("ada@example.com", "Ada"));
    const bobOnEvent = (await named.json()).event.participants.find((item) => item.userId === "bob@example.com");
    assert.equal(bobOnEvent.name, "Robert Smith");
    assert.equal(bobOnEvent.firstName, "Robert");
    assert.equal(bobOnEvent.lastName, "Smith");
    assert.equal(bobOnEvent.picture, "https://example.com/bob.png");
  });

  it("reads given name from userinfo JSON", async () => {
    const res = await fetch(
      `${base}/api/session`,
      asPortal("ada@example.com", "Ada Lovelace", {}, {
        "X-Auth-Request-Userinfo": JSON.stringify({
          given_name: "Ada",
          family_name: "Lovelace",
          picture: "https://example.com/ada.png",
        }),
      }),
    );
    const body = await res.json();
    assert.equal(body.user.firstName, "Ada");
    assert.equal(body.user.lastName, "Lovelace");
    assert.equal(body.user.picture, "https://example.com/ada.png");
  });
});
