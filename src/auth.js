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
    const email = String(item.email ?? "").trim();
    if (!id || !name) {
      throw new Error(`users[${index}] needs id and name`);
    }
    return { id, name, email };
  });
}

export function getUser(req, dataDir, examplePath) {
  const id = String(req.get("X-Test-User") ?? "").trim();
  if (!id) {
    return null;
  }
  return readUsers(dataDir, examplePath).find((user) => user.id === id) ?? null;
}

export function requireUser(req, res, dataDir, examplePath) {
  const user = getUser(req, dataDir, examplePath);
  if (!user) {
    res.status(401).json({ error: "unknown or missing test user" });
    return null;
  }
  return user;
}
