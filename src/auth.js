import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function configFile(dataDir) {
  return path.join(dataDir, "config.json");
}

export function ensureConfigFile(dataDir, examplePath) {
  mkdirSync(dataDir, { recursive: true });
  const dest = configFile(dataDir);
  if (!existsSync(dest)) {
    copyFileSync(examplePath, dest);
  }
  return dest;
}

export function readUsers(dataDir, examplePath) {
  const dest = ensureConfigFile(dataDir, examplePath);
  const raw = JSON.parse(readFileSync(dest, "utf8"));
  if (!Array.isArray(raw?.users)) {
    throw new Error("config.users must be an array");
  }
  return raw.users.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`users[${index}] is invalid`);
    }
    const id = String(item.id ?? "").trim();
    const name = String(item.name ?? "").trim();
    const email = String(item.email ?? "").trim().toLowerCase();
    if (!id || !name) {
      throw new Error(`users[${index}] needs id and name`);
    }
    return { id, name, email };
  });
}

function proxyUser(req) {
  const email = String(req.get("X-Auth-Request-Email") ?? "").trim().toLowerCase();
  if (!email) {
    return null;
  }
  const name = String(req.get("X-Auth-Request-User") ?? "").trim() || email.split("@")[0];
  return { id: email, name, email, source: "portal" };
}

function testUser(req, dataDir, examplePath) {
  const raw = String(req.get("X-Test-User") ?? "").trim();
  if (!raw) {
    return null;
  }
  const found = readUsers(dataDir, examplePath).find((user) => user.id === raw || user.email === raw);
  return found ? { ...found, source: "test" } : null;
}

export function getUser(req, { dataDir, configExamplePath, trustProxyIdentity = false } = {}) {
  if (trustProxyIdentity) {
    return proxyUser(req);
  }
  return testUser(req, dataDir, configExamplePath);
}

export function requireUser(req, res, ctx) {
  const user = getUser(req, ctx);
  if (!user) {
    res.status(401).json({ error: "unknown or missing user" });
    return null;
  }
  return user;
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}
