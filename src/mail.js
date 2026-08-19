import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const defaultTemplatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

const MAILER_SEND_API = "https://api.mailersend.com/v1/email";

export function mailerSendApiKey(env = process.env) {
  return String(env.MAILSERSEND_API_KEY || env.MAILERSEND_API_KEY || "").trim();
}

export function smtpConfig(env = process.env) {
  const apiKey = mailerSendApiKey(env);
  return {
    host: String(env.SMTP_HOST || "smtp.mailersend.net").trim() || "smtp.mailersend.net",
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: String(env.SMTP_USER || "").trim(),
      pass: String(env.SMTP_PASS || apiKey).trim(),
    },
  };
}

export function mailFrom(env = process.env) {
  const email = String(env.MAIL_FROM || env.MAILERSEND_FROM || "").trim().toLowerCase();
  const name = String(env.MAIL_FROM_NAME || "Calendar").trim() || "Calendar";
  return { email: email || "calendar@localhost", name };
}

export function renderTemplate(source, vars = {}) {
  return String(source).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function htmlVars(vars) {
  const out = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key] = typeof value === "string" && !String(key).endsWith("Html") ? escapeHtml(value) : value;
  }
  return out;
}

function loadTemplate(templatesDir, name, ext) {
  const file = path.join(templatesDir, `${name}.${ext}`);
  if (!existsSync(file)) {
    throw new Error(`missing email template ${name}.${ext}`);
  }
  return readFileSync(file, "utf8");
}

async function sendViaSmtp(config, message) {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth.user ? config.auth : undefined,
  });
  try {
    await transport.sendMail({
      from: message.from.name ? `"${message.from.name}" <${message.from.email}>` : message.from.email,
      to: message.to.name ? `"${message.to.name}" <${message.to.email}>` : message.to.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } finally {
    transport.close?.();
  }
}

async function sendViaMailerSendApi(apiKey, message, fetchImpl = fetch) {
  const res = await fetchImpl(MAILER_SEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { email: message.from.email, name: message.from.name },
      to: [{ email: message.to.email, name: message.to.name }],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!res.ok && res.status !== 202) {
    const body = await res.text().catch(() => "");
    throw new Error(`MailerSend rejected the message (${res.status})${body ? `: ${body}` : ""}`);
  }
}

export function createMailer({
  env = process.env,
  standalone = true,
  templatesDir = defaultTemplatesDir,
  fetchImpl = fetch,
} = {}) {
  const outbox = [];

  async function deliver(message) {
    const entry = {
      ...message,
      at: new Date().toISOString(),
      simulated: Boolean(standalone),
    };
    outbox.push(entry);
    if (standalone) {
      console.log(`[mail:simulated] to=${message.to.email} subject=${message.subject}`);
      return entry;
    }
    const smtp = smtpConfig(env);
    if (smtp.auth.user && smtp.auth.pass) {
      await sendViaSmtp(smtp, message);
      return { ...entry, transport: "smtp" };
    }
    const apiKey = mailerSendApiKey(env);
    if (apiKey) {
      await sendViaMailerSendApi(apiKey, message, fetchImpl);
      return { ...entry, transport: "mailersend" };
    }
    return { ...entry, skipped: true };
  }

  async function sendTemplate(name, { to, subject, vars }) {
    const from = mailFrom(env);
    const text = renderTemplate(loadTemplate(templatesDir, name, "txt"), vars);
    const html = renderTemplate(loadTemplate(templatesDir, name, "html"), htmlVars({ ...vars, subject }));
    return deliver({
      from,
      to: { email: String(to.email || "").trim().toLowerCase(), name: String(to.name || to.email || "").trim() },
      subject,
      text,
      html,
      template: name,
    });
  }

  return { outbox, sendTemplate, deliver, standalone };
}
