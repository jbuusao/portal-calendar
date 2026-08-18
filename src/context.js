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
    return {
      id: String(found.id),
      name: String(found.name),
      email: String(found.email ?? "").trim().toLowerCase(),
      source: "test",
    };
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
    const email = header(req, "X-Auth-Request-Email").toLowerCase();
    if (!email) {
      return null;
    }
    const name = header(req, "X-Auth-Request-User") || email.split("@")[0];
    return { id: email, name, email, source: "portal" };
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
