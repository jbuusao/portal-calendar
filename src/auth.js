import { parseDisplayName } from "./contacts.js";

export function usersFromConfig(config) {
  if (!Array.isArray(config?.users)) {
    throw new Error("config.users must be an array");
  }
  return config.users.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`users[${index}] is invalid`);
    }
    const id = String(item.id ?? "").trim();
    const name = String(item.name ?? "").trim();
    const email = String(item.email ?? "").trim().toLowerCase();
    if (!id || !name) {
      throw new Error(`users[${index}] needs id and name`);
    }
    const split = parseDisplayName(name);
    return {
      id,
      name,
      email,
      firstName: String(item.givenName ?? item.firstName ?? split.firstName).trim(),
      lastName: String(item.familyName ?? item.lastName ?? split.lastName).trim(),
      picture: String(item.picture ?? "").trim(),
    };
  });
}

export function requireUser(req, res, context) {
  const user = context.user(req);
  if (!user) {
    res.status(401).json({ error: "unknown or missing user" });
    return null;
  }
  return user;
}

export function publicUser(user) {
  const firstName = user.firstName || user.givenName || "";
  const lastName = user.lastName || user.familyName || "";
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    givenName: user.givenName || firstName,
    familyName: user.familyName || lastName,
    firstName,
    lastName,
    picture: user.picture || "",
    login: user.login || "",
  };
}
