import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createContext } from "../src/context.js";
import { aggregateActivity, formatActivityText } from "../src/activity.js";
import { eventPageUrl } from "../src/invite.js";
import { mailerSendApiKey, mailDeliveryMessage, renderTemplate, smtpConfig } from "../src/mail.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const examplePath = path.join(root, "data", "events.example.json");
const configExamplePath = path.join(root, "data", "config.example.json");
const publicDir = path.join(root, "public");
const templatesDir = path.join(root, "templates");

function asUser(id, init = {}) {
  const headers = { "X-Test-User": id, ...(init.headers ?? {}) };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return { ...init, headers };
}

describe("mail templates and MailerSend config", () => {
  it("reads MAILERSEND_API_KEY and the MAILSERSEND_API_KEY alias", () => {
    assert.equal(mailerSendApiKey({ MAILERSEND_API_KEY: "mlsn.one" }), "mlsn.one");
    assert.equal(mailerSendApiKey({ MAILSERSEND_API_KEY: "mlsn.two" }), "mlsn.two");
  });

  it("defaults SMTP to MailerSend and uses the API key as the password", () => {
    const smtp = smtpConfig({ MAILSERSEND_API_KEY: "mlsn.test" });
    assert.equal(smtp.host, "smtp.mailersend.net");
    assert.equal(smtp.port, 587);
    assert.equal(smtp.auth.pass, "mlsn.test");
  });

  it("renders invitation placeholders", () => {
    const text = renderTemplate("Hi {{inviteeName}}, join {{eventName}}", {
      inviteeName: "Bob",
      eventName: "Tennis match",
    });
    assert.equal(text, "Hi Bob, join Tennis match");
  });

  it("builds an event page URL from APP_URL and the event id", () => {
    assert.equal(eventPageUrl("https://buusao.com", "a1b2c3d4"), "https://buusao.com/events/a1b2c3d4");
    assert.equal(eventPageUrl("https://buusao.com/", "a1b2c3d4"), "https://buusao.com/events/a1b2c3d4");
    assert.equal(eventPageUrl("/", "a1b2c3d4"), "/events/a1b2c3d4");
  });

  it("maps MailerSend trial recipient limits to a clear message", () => {
    assert.match(
      mailDeliveryMessage(new Error('MailerSend rejected the message (422): {"message":"You have reached trial account unique recipients limit. #MS42225"}')),
      /2 unique addresses/,
    );
  });
});

describe("simulated mail in standalone", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-mail-"));
    app = createApp({ dataDir, examplePath, configExamplePath, publicDir, templatesDir });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    app?.locals?.stopMailJobs?.();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    app?.locals?.db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("simulates invitation emails only when they are sent", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Mail picnic", inviteeIds: ["bob"], venue: "Park" }),
      }),
    );
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.equal(app.locals.mailer.outbox.filter((item) => item.template === "invitation").length, 0);

    const sent = await fetch(`${base}/api/events/${event.id}/invitations`, asUser("alice", { method: "POST", body: "{}" }));
    assert.equal(sent.status, 200);
    const invites = app.locals.mailer.outbox.filter((item) => item.template === "invitation");
    assert.equal(invites.length, 1);
    assert.equal(invites[0].simulated, true);
    assert.equal(invites[0].to.email, "bob@example.com");
    assert.match(invites[0].subject, /Mail picnic/);
    assert.match(invites[0].text, /Park/);
    assert.match(invites[0].html, /Mail picnic/);
    assert.match(invites[0].text, new RegExp(`/events/${event.id}`));
    assert.match(invites[0].html, new RegExp(`/events/${event.id}`));
  });

  it("addresses the invitee by first name in invitation email", async () => {
    await fetch(
      `${base}/api/contacts`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Robert",
          lastName: "Neighbor",
          nickname: "Bobby",
          emails: ["robert.neighbor@example.net"],
        }),
      }),
    );
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Named mail", inviteeIds: ["robert.neighbor@example.net"] }),
      }),
    );
    const { event } = await created.json();
    const sent = await fetch(`${base}/api/events/${event.id}/invitations`, asUser("alice", { method: "POST", body: "{}" }));
    assert.equal(sent.status, 200);
    const invite = app.locals.mailer.outbox
      .filter((item) => item.template === "invitation" && item.to.email === "robert.neighbor@example.net")
      .at(-1);
    assert.match(invite.text, /Hi Robert,/);
    assert.doesNotMatch(invite.text, /Hi Bobby/);
    assert.doesNotMatch(invite.text, /Hi Robert Neighbor/);
    assert.equal(invite.to.name, "Robert Neighbor");
    assert.match(invite.text, /Alice invited you/);
  });

  it("sends cancellation emails when an event is deleted with notify", async () => {
    const created = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Cancelled picnic", inviteeIds: ["bob"] }),
      }),
    );
    const { event } = await created.json();
    await fetch(`${base}/api/events/${event.id}/invitations`, asUser("alice", { method: "POST", body: "{}" }));
    const before = app.locals.mailer.outbox.filter((item) => item.template === "cancellation").length;

    const quiet = await fetch(
      `${base}/api/events`,
      asUser("alice", {
        method: "POST",
        body: JSON.stringify({ name: "Quiet delete", inviteeIds: ["bob"] }),
      }),
    );
    const quietEvent = (await quiet.json()).event;
    await fetch(`${base}/api/events/${quietEvent.id}/invitations`, asUser("alice", { method: "POST", body: "{}" }));
    const silent = await fetch(
      `${base}/api/events/${quietEvent.id}`,
      asUser("alice", { method: "DELETE", body: JSON.stringify({ notify: false }) }),
    );
    assert.equal(silent.status, 200);
    assert.equal((await silent.json()).sent, 0);
    assert.equal(app.locals.mailer.outbox.filter((item) => item.template === "cancellation").length, before);

    const cancelled = await fetch(
      `${base}/api/events/${event.id}`,
      asUser("alice", { method: "DELETE", body: JSON.stringify({ notify: true }) }),
    );
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).sent, 1);
    const notes = app.locals.mailer.outbox.filter((item) => item.template === "cancellation");
    assert.equal(notes.length, before + 1);
    assert.equal(notes.at(-1).to.email, "bob@example.com");
    assert.match(notes.at(-1).subject, /Cancelled picnic/);
    assert.match(notes.at(-1).text, /cancelled this event/i);
  });

  it("sends an aggregated daily digest to the admin", async () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const sent = await app.locals.sendDailyDigest({ day, force: true });
    assert.ok(sent);
    assert.equal(sent.template, "daily-admin");
    assert.equal(sent.to.email, "alice@example.com");
    assert.match(sent.text, /events created/i);
    assert.match(sent.html, /Daily digest/);
  });
});

describe("activity aggregation", () => {
  it("counts types and formats a text list", () => {
    const rows = [
      { type: "event_created", at: "2026-08-19T10:00:00.000Z", summary: "Alice created Tennis" },
      { type: "invite_sent", at: "2026-08-19T10:00:01.000Z", summary: "Invited Bob" },
      { type: "invite_sent", at: "2026-08-19T10:00:02.000Z", summary: "Invited Cara" },
    ];
    const stats = aggregateActivity(rows);
    assert.equal(stats.eventsCreated, 1);
    assert.equal(stats.invitesSent, 2);
    assert.match(formatActivityText(rows), /Invitation sent/);
  });
});

describe("embedded MailerSend API delivery", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;
  let posted;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-mail-api-"));
    posted = [];
    const { createMailer } = await import("../src/mail.js");
    const mailer = createMailer({
      env: {
        MAILSERSEND_API_KEY: "mlsn.test-key",
        MAIL_FROM: "calendar@example.com",
      },
      standalone: false,
      templatesDir,
      fetchImpl: async (url, init) => {
        posted.push({ url, init });
        return { ok: true, status: 202, text: async () => "" };
      },
    });
    app = createApp({
      dataDir,
      examplePath,
      publicDir,
      templatesDir,
      mailer,
      context: createContext({ mode: "embedded", slug: "calendar", config: { adminEmail: "ada@example.com" } }),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    app?.locals?.stopMailJobs?.();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    app?.locals?.db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("posts invitations through the MailerSend API", async () => {
    const created = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Request-Email": "ada@example.com",
        "X-Auth-Request-User": "Ada",
      },
      body: JSON.stringify({ name: "Portal picnic", inviteeIds: ["bob@example.com"] }),
    });
    assert.equal(created.status, 201);
    const { event } = await created.json();
    assert.equal(posted.length, 0);

    const sent = await fetch(`${base}/api/events/${event.id}/invitations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Request-Email": "ada@example.com",
        "X-Auth-Request-User": "Ada",
      },
      body: "{}",
    });
    assert.equal(sent.status, 200);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, "https://api.mailersend.com/v1/email");
    const body = JSON.parse(posted[0].init.body);
    assert.equal(body.to[0].email, "bob@example.com");
    assert.match(body.subject, /Portal picnic/);
    assert.match(posted[0].init.headers.Authorization, /mlsn\.test-key/);
  });
});

describe("embedded MailerSend failures surface to the client", { concurrency: false }, () => {
  let dataDir;
  let server;
  let app;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "calendar-mail-fail-"));
    const { createMailer } = await import("../src/mail.js");
    const mailer = createMailer({
      env: {
        MAILSERSEND_API_KEY: "mlsn.test-key",
        MAIL_FROM: "calendar@example.com",
      },
      standalone: false,
      templatesDir,
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        text: async () => '{"message":"You have reached trial account unique recipients limit. #MS42225"}',
      }),
    });
    app = createApp({
      dataDir,
      examplePath,
      publicDir,
      templatesDir,
      mailer,
      context: createContext({ mode: "embedded", slug: "calendar", config: { adminEmail: "ada@example.com" } }),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    app?.locals?.stopMailJobs?.();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    app?.locals?.db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns 502 instead of pretending invitations were sent", async () => {
    const created = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Request-Email": "ada@example.com",
        "X-Auth-Request-User": "Ada",
      },
      body: JSON.stringify({ name: "Blocked picnic", inviteeIds: ["bob@example.com"] }),
    });
    const { event } = await created.json();
    const sent = await fetch(`${base}/api/events/${event.id}/invitations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Request-Email": "ada@example.com",
        "X-Auth-Request-User": "Ada",
      },
      body: "{}",
    });
    assert.equal(sent.status, 502);
    const body = await sent.json();
    assert.match(body.error, /2 unique addresses/);
    assert.equal(body.sent, 0);
    const listed = await fetch(`${base}/api/events/${event.id}`, {
      headers: { "X-Auth-Request-Email": "ada@example.com" },
    });
    const after = await listed.json();
    assert.equal(after.event.participants.find((item) => item.userId === "bob@example.com").notifiedAt, "");
  });
});
