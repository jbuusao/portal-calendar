import { slotEnd } from "./events.js";
import { correspondenceName, greetingName } from "./names.js";

export function eventPageUrl(appUrl, eventId) {
  const base = String(appUrl || "").trim().replace(/\/+$/, "");
  const id = encodeURIComponent(String(eventId || "").trim());
  if (!id) {
    return base || "/";
  }
  return `${base}/events/${id}`;
}

/** Record-only invite rows. Email delivery is handled by the mailer (simulated in standalone). */
export function simulateInvites(eventId, inviteeIds) {
  const at = new Date().toISOString();
  return inviteeIds.map((userId) => ({ eventId, userId, at }));
}

function formatDuration(minutes) {
  const value = Number(minutes) || 60;
  if (value < 60) {
    return `${value} min`;
  }
  const hours = value / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function eventWhenLabel(event) {
  if (!event?.slots?.length) {
    return "Times to be decided";
  }
  return event.slots
    .map((slot) => `${slot.date} ${slot.start}–${slot.end || slotEnd(slot.start, event.durationMinutes)}`)
    .join(", ");
}

export async function sendEventInvitations({ mailer, event, creator, invitees, appUrl, update = false }) {
  const sent = [];
  for (const invitee of invitees) {
    const email = String(invitee?.email || "").trim().toLowerCase();
    if (!email) {
      continue;
    }
    const result = await mailer.sendTemplate("invitation", {
        to: { email, name: correspondenceName(invitee, email) },
        subject: update ? `Update: ${event.name || event.title}` : `You're invited: ${event.name || event.title}`,
        vars: {
          subject: update ? `Update: ${event.name || event.title}` : `You're invited: ${event.name || event.title}`,
          inviteeName: greetingName(invitee, email.split("@")[0]),
          creatorName: greetingName(creator, event.createdBy),
        eventName: event.name || event.title || "an event",
        description: event.description || "No description provided.",
        venue: event.venue || "To be decided",
        duration: formatDuration(event.durationMinutes),
        when: eventWhenLabel(event),
        appUrl: appUrl || "/",
      },
    });
    sent.push({ ...result, userId: invitee.userId || invitee.id, update: Boolean(update) });
  }
  return sent;
}

export async function sendEventCancellations({ mailer, event, creator, invitees, appUrl }) {
  const sent = [];
  const eventName = event.name || event.title || "an event";
  for (const invitee of invitees) {
    const email = String(invitee?.email || "").trim().toLowerCase();
    if (!email) {
      continue;
    }
    const result = await mailer.sendTemplate("cancellation", {
        to: { email, name: correspondenceName(invitee, email) },
        subject: `Cancelled: ${eventName}`,
        vars: {
          subject: `Cancelled: ${eventName}`,
          inviteeName: greetingName(invitee, email.split("@")[0]),
          creatorName: greetingName(creator, event.createdBy),
        eventName,
        description: event.description || "No description provided.",
        venue: event.venue || "To be decided",
        duration: formatDuration(event.durationMinutes),
        when: eventWhenLabel(event),
        appUrl: appUrl || "/",
      },
    });
    sent.push({ ...result, userId: invitee.userId || invitee.id });
  }
  return sent;
}
