export function correspondenceName(person, fallback = "") {
  const first = String(person?.firstName || person?.givenName || "").trim();
  const last = String(person?.lastName || person?.familyName || "").trim();
  const full = [first, last].filter(Boolean).join(" ");
  if (full) {
    return full;
  }
  const name = String(person?.name || "").trim();
  if (name && !name.includes("@")) {
    return name;
  }
  const email = String(person?.email || "").trim().toLowerCase();
  if (email.includes("@")) {
    return email.split("@")[0];
  }
  return String(fallback || name || email || "").trim();
}

export function greetingName(person, fallback = "") {
  const first = String(person?.firstName || person?.givenName || "").trim();
  if (first) {
    return first;
  }
  const nick = String(person?.nickname || "").trim();
  const name = String(person?.name || "").trim();
  if (name && !name.includes("@") && name !== nick) {
    return name.split(/\s+/)[0];
  }
  const email = String(person?.email || "").trim().toLowerCase();
  if (email.includes("@")) {
    return email.split("@")[0];
  }
  return String(fallback || email || "").trim();
}

