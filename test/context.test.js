import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createContext, detectMode, EmbeddedContext, StandaloneContext } from "../src/context.js";

describe("detectMode", () => {
  it("defaults to standalone", () => {
    assert.equal(detectMode({}), "standalone");
  });

  it("treats PORTAL_MODE, PORTAL_SLUG, or PORTAL_CONFIG as embedded", () => {
    assert.equal(detectMode({ PORTAL_MODE: "embedded" }), "embedded");
    assert.equal(detectMode({ PORTAL_SLUG: "calendar" }), "embedded");
    assert.equal(detectMode({ PORTAL_CONFIG: "/portal-config/plugins.json" }), "embedded");
    assert.equal(detectMode({ PORTAL_MODE: "standalone", PORTAL_SLUG: "calendar" }), "standalone");
  });
});

describe("StandaloneContext", () => {
  let dataDir;
  let examplePath;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "ctx-standalone-"));
    examplePath = path.join(dataDir, "config.example.json");
    await writeFile(
      examplePath,
      JSON.stringify({ users: [{ id: "alice", name: "Alice", email: "alice@example.com" }], theme: "dark" }),
    );
  });

  after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("seeds config.json and reads values", () => {
    const ctx = createContext({ dataDir, configExamplePath: examplePath });
    assert.ok(ctx instanceof StandaloneContext);
    assert.equal(ctx.mode, "standalone");
    assert.equal(ctx.get("theme"), "dark");
    assert.equal(ctx.user({ get: () => "" }), null);
    assert.equal(
      ctx.user({
        get: (name) => (name === "X-Test-User" ? "alice" : ""),
      }).givenName,
      "Alice",
    );
    assert.equal(ctx.user({ get: (name) => (name === "X-Test-User" ? "nope" : "") }), null);
  });
});

describe("EmbeddedContext", () => {
  let dir;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ctx-embedded-"));
    await mkdir(path.join(dir, "config"), { recursive: true });
    await writeFile(
      path.join(dir, "config", "plugins.json"),
      JSON.stringify({ calendar: { timezone: "Europe/London" }, other: { timezone: "UTC" } }),
    );
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the plugin section and proxy identity", () => {
    const ctx = createContext({
      env: {
        PORTAL_MODE: "embedded",
        PORTAL_SLUG: "calendar",
        PORTAL_CONFIG: path.join(dir, "config", "plugins.json"),
      },
    });
    assert.ok(ctx instanceof EmbeddedContext);
    assert.equal(ctx.mode, "embedded");
    assert.equal(ctx.slug, "calendar");
    assert.equal(ctx.get("timezone"), "Europe/London");
    assert.equal(ctx.user({ get: () => "" }), null);
    const ada = ctx.user({
      get: (name) =>
        ({
          "X-Auth-Request-Email": "ada@example.com",
          "X-Auth-Request-User": "Ada Lovelace",
          "X-Auth-Request-Given-Name": "Ada",
          "X-Auth-Request-Family-Name": "Lovelace",
          "X-Auth-Request-Picture": "https://example.com/ada.png",
          "X-Auth-Request-Login": "ada",
        })[name] || "",
    });
    assert.deepEqual(ada, {
      id: "ada@example.com",
      name: "Ada Lovelace",
      email: "ada@example.com",
      givenName: "Ada",
      familyName: "Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      picture: "https://example.com/ada.png",
      login: "ada",
      source: "portal",
    });
    const packed = Buffer.from(
      JSON.stringify({
        email: "ada@example.com",
        name: "Ada Lovelace",
        givenName: "Ada",
        familyName: "Lovelace",
        picture: "https://example.com/ada.png",
        preferredUsername: "ada",
      }),
      "utf8",
    ).toString("base64");
    const fromJson = ctx.user({
      get: (name) => (name === "X-Auth-Request-Userinfo" ? packed : ""),
    });
    assert.equal(fromJson.givenName, "Ada");
    assert.equal(fromJson.familyName, "Lovelace");
    assert.equal(fromJson.picture, "https://example.com/ada.png");
    assert.equal(ctx.user({ get: (name) => (name === "X-Test-User" ? "alice" : "") }), null);
  });
});
