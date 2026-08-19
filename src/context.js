import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function detectMode(env = process.env) {
  const explicit = String(env.PORTAL_MODE || "").trim().toLowerCase();
  if (explicit === "embedded" || explicit === "portal") {
    return "embedded";
  }
  if (explicit === "standalone") {
    return "standalone";
  }
  if (String(env.PORTAL_SLUG || "").trim() || String(env.PORTAL_CONFIG || "").trim()) {
    return "embedded";
  }
  return "standalone";
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function header(req, name) {
  if (!req) {
    return "";
  }
  if (typeof req.get === "function") {
    return String(req.get(name) ?? "").trim();
  }
  const headers = req.headers || {};
  return String(headers[name.toLowerCase()] ?? "").trim();
}

function parseUserinfo(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
}

function pictureFrom(value) {
  const url = String(value ?? "").trim();
  if (!url || url.length > 500) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function splitDisplayName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || parts[0].includes("@")) {
    return { givenName: "", familyName: "" };
  }
  if (parts.length === 1) {
    return { givenName: parts[0], familyName: "" };
  }
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

function identityUser({ id, name, email, givenName, familyName, picture, login, source }) {
  const display = String(name || "").trim() || [givenName, familyName].filter(Boolean).join(" ") || email.split("@")[0] || id;
  const split = splitDisplayName(display);
  const first = String(givenName || split.givenName || "").trim();
  const last = String(familyName || split.familyName || "").trim();
  return {
    id: String(id),
    name: display,
    email: String(email || "").trim().toLowerCase(),
    givenName: first,
    familyName: last,
    firstName: first,
    lastName: last,
    picture: pictureFrom(picture),
    login: String(login || "").trim() || undefined,
    source,
  };
}

export function standaloneConfigFile(dataDir) {
  return path.join(dataDir, "config.json");
}

export function ensureStandaloneConfig(dataDir, examplePath) {
  mkdirSync(dataDir, { recursive: true });
  const dest = standaloneConfigFile(dataDir);
  if (!existsSync(dest) && examplePath && existsSync(examplePath)) {
    copyFileSync(examplePath, dest);
  }
  return dest;
}

class BaseContext {
  constructor({ mode, slug, section, configPath }) {
    this.mode = mode;
    this.slug = slug || null;
    this.configPath = configPath || null;
    this._section = section && typeof section === "object" && !Array.isArray(section) ? section : {};
  }

  get embedded() {
    return this.mode === "embedded";
  }

  get standalone() {
    return this.mode === "standalone";
  }

  config() {
    return this._section;
  }

  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this._section, key) ? this._section[key] : fallback;
  }

  user(_req) {
    return null;
  }
}

export class StandaloneContext extends BaseContext {
  constructor(options = {}) {
    const configPath = options.configPath || (options.dataDir ? ensureStandaloneConfig(options.dataDir, options.configExamplePath) : null);
    let section = options.config;
    if (section == null && configPath && existsSync(configPath)) {
      section = readJson(configPath);
    }
    super({
      mode: "standalone",
      slug: options.slug,
      section: section ?? {},
      configPath,
    });
  }

  user(req) {
    const raw = header(req, "X-Test-User");
    if (!raw) {
      return null;
    }
    const users = Array.isArray(this._section.users) ? this._section.users : [];
    const found = users.find((item) => item && (item.id === raw || item.email === raw));
    if (!found) {
      return null;
    }
    return identityUser({
      id: found.id,
      name: found.name,
      email: found.email,
      givenName: found.givenName ?? found.firstName,
      familyName: found.familyName ?? found.lastName,
      picture: found.picture,
      login: found.login ?? found.preferredUsername ?? found.id,
      source: "test",
    });
  }
}

export class EmbeddedContext extends BaseContext {
  constructor(options = {}, env = process.env) {
    const slug = options.slug || String(env.PORTAL_SLUG || "").trim() || null;
    const configPath = options.configPath || String(env.PORTAL_CONFIG || "").trim() || null;
    let section = options.config;
    if (section == null && configPath && existsSync(configPath) && slug) {
      const all = readJson(configPath);
      section = all && typeof all === "object" ? all[slug] : undefined;
    }
    super({
      mode: "embedded",
      slug,
      section: section ?? {},
      configPath,
    });
  }

  user(req) {
    const userinfo = parseUserinfo(header(req, "X-Auth-Request-Userinfo"));
    const email = (header(req, "X-Auth-Request-Email") || String(userinfo.email ?? "")).toLowerCase();
    if (!email) {
      return null;
    }
    const name = header(req, "X-Auth-Request-User") || String(userinfo.name ?? "") || email.split("@")[0];
    const givenName =
      header(req, "X-Auth-Request-Given-Name") || String(userinfo.givenName ?? userinfo.given_name ?? userinfo.firstName ?? "");
    const familyName =
      header(req, "X-Auth-Request-Family-Name") || String(userinfo.familyName ?? userinfo.family_name ?? userinfo.lastName ?? "");
    const picture = header(req, "X-Auth-Request-Picture") || userinfo.picture || userinfo.avatar_url || "";
    const login = header(req, "X-Auth-Request-Login") || String(userinfo.preferredUsername ?? userinfo.login ?? "");
    return identityUser({
      id: email,
      name,
      email,
      givenName,
      familyName,
      picture,
      login,
      source: "portal",
    });
  }
}

export function createContext(options = {}) {
  const env = options.env ?? process.env;
  const mode = options.mode ?? detectMode(env);
  if (mode === "embedded") {
    return new EmbeddedContext(options, env);
  }
  return new StandaloneContext(options);
}
