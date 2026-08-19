import { toIsoDate } from "./events.js";
import { escapeHtml } from "./mail.js";

export function logActivity(db, { type, actorId = "", eventId = null, summary = "", at = new Date() }) {
  const when = at instanceof Date ? at : new Date(at);
  db.prepare("INSERT INTO activity (day, at, type, actor_id, event_id, summary) VALUES (?, ?, ?, ?, ?, ?)").run(
    toIsoDate(when),
    when.toISOString(),
    type,
    actorId,
    eventId,
    summary,
  );
}

export function activityForDay(db, day) {
  return db.prepare("SELECT id, day, at, type, actor_id, event_id, summary FROM activity WHERE day = ? ORDER BY at, id").all(day);
}

export function aggregateActivity(rows) {
  const count = (type) => rows.filter((row) => row.type === type).length;
  return {
    total: rows.length,
    eventsCreated: count("event_created"),
    invitesSent: count("invite_sent"),
    slotsAdded: count("slot_added"),
    votes: count("vote_cast"),
    accepts: count("invite_accepted"),
    confirmed: count("event_confirmed"),
    slotsDeleted: count("slot_deleted"),
    eventsDeleted: count("event_deleted"),
  };
}

function activityLabel(type) {
  return (
    {
      event_created: "Event created",
      invite_sent: "Invitation sent",
      slot_added: "Slot proposed",
      vote_cast: "Vote",
      vote_removed: "Vote removed",
      invite_accepted: "Invite accepted",
      invite_cancelled: "Invitation cancelled",
      event_confirmed: "Event confirmed",
      slot_deleted: "Slot deleted",
      event_deleted: "Event deleted",
    }[type] ?? type
  );
}

export function formatActivityHtml(rows) {
  if (!rows.length) {
    return `<p style="margin:0;color:#70757a;">No activity recorded.</p>`;
  }
  const items = rows
    .map((row) => {
      const time = String(row.at).slice(11, 16);
      return `<tr>
        <td style="padding:6px 8px;border-top:1px solid #dadce0;color:#70757a;white-space:nowrap;">${escapeHtml(time)}</td>
        <td style="padding:6px 8px;border-top:1px solid #dadce0;">${escapeHtml(activityLabel(row.type))}</td>
        <td style="padding:6px 8px;border-top:1px solid #dadce0;">${escapeHtml(row.summary)}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;line-height:1.4;">
    <tr>
      <th align="left" style="padding:0 8px 8px;color:#70757a;font-weight:500;">Time</th>
      <th align="left" style="padding:0 8px 8px;color:#70757a;font-weight:500;">Activity</th>
      <th align="left" style="padding:0 8px 8px;color:#70757a;font-weight:500;">Detail</th>
    </tr>
    ${items}
  </table>`;
}

export function formatActivityText(rows) {
  if (!rows.length) {
    return "No activity recorded.";
  }
  return rows.map((row) => `- ${String(row.at).slice(11, 16)} ${activityLabel(row.type)}: ${row.summary}`).join("\n");
}

export function getMeta(db, key) {
  return db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    String(value),
  );
}

export function adminAddress(ctx, env = process.env) {
  const fromEnv = String(env.MAIL_ADMIN || "").trim().toLowerCase();
  if (fromEnv) {
    return { email: fromEnv, name: "Admin" };
  }
  const fromConfig = String(ctx?.get?.("adminEmail") || ctx?.config?.()?.adminEmail || "").trim().toLowerCase();
  if (fromConfig) {
    return { email: fromConfig, name: "Admin" };
  }
  return null;
}

function previousIsoDate(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
}

export async function sendDailyAdminDigest({
  db,
  mailer,
  ctx,
  env = process.env,
  now = new Date(),
  day,
  force = false,
}) {
  const digestHour = Number(env.MAIL_DIGEST_HOUR ?? 7);
  const targetDay = day || previousIsoDate(now);
  if (!force) {
    if (now.getHours() < digestHour) {
      return null;
    }
    if (getMeta(db, "digest.sent") === targetDay) {
      return null;
    }
  }
  const admin = adminAddress(ctx, env);
  if (!admin) {
    return null;
  }
  const rows = activityForDay(db, targetDay);
  const stats = aggregateActivity(rows);
  const sent = await mailer.sendTemplate("daily-admin", {
    to: admin,
    subject: `Calendar activity for ${targetDay}`,
    vars: {
      date: targetDay,
      subject: `Calendar activity for ${targetDay}`,
      eventsCreated: String(stats.eventsCreated),
      invitesSent: String(stats.invitesSent),
      slotsAdded: String(stats.slotsAdded),
      votes: String(stats.votes),
      accepts: String(stats.accepts),
      confirmed: String(stats.confirmed),
      total: String(stats.total),
      activityWord: stats.total === 1 ? "item" : "items",
      activityHtml: formatActivityHtml(rows),
      activityText: formatActivityText(rows),
    },
  });
  setMeta(db, "digest.sent", targetDay);
  return sent;
}
