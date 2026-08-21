import path from "node:path";
import express from "express";
import { logActivity, sendDailyAdminDigest } from "./activity.js";
import { publicUser, requireUser, usersFromConfig } from "./auth.js";
import { createContext } from "./context.js";
import { openDatabase } from "./db.js";
import {
  addSlot,
  addInvitees,
  allocateEventId,
  createEvent,
  deleteSlot,
  deleteStoredEvent,
  eventsForUser,
  initializeEventsStore,
  isEmail,
  isParticipant,
  loadEvent,
  loadEvents,
  lockSlot,
  acceptInvitee,
  cancellationRecipients,
  markInviteesNotified,
  notifiedInvitees,
  participantKey,
  pendingInvitees,
  removeInvitee,
  saveEvent,
  toggleVote,
  updateEvent,
} from "./events.js";
import {
  createContact,
  deleteContact,
  ensureContactsForEmails,
  findContactForPerson,
  listContacts,
  loadContact,
  maxContacts,
  personNameOf,
  rememberIdentity,
  findIdentity,
  updateContact,
} from "./contacts.js";
import { sendEventCancellations, sendEventInvitations, eventPageUrl } from "./invite.js";
import { createMailer, defaultTemplatesDir, mailDeliveryMessage } from "./mail.js";
import { correspondenceName } from "./names.js";

function httpError(err, fallback = 400) {
  return err?.status ?? fallback;
}

export function createApp({
  dataDir,
  examplePath,
  configExamplePath,
  publicDir,
  context,
  env,
  templatesDir,
  mailer,
  scheduleDigest = false,
}) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  const environment = env ?? process.env;
  const ctx =
    context ??
    createContext({
      dataDir,
      configExamplePath,
      env: environment,
    });
  const directoryIds = () =>
    ctx.embedded ? null : new Set(usersFromConfig(ctx.config()).map((user) => user.id));
  const directoryUsers = () => {
    try {
      return ctx.embedded ? [] : usersFromConfig(ctx.config());
    } catch {
      return [];
    }
  };
  const contactForPerson = (ownerId, userId) => {
    const known = directoryUsers().find((user) => user.id === userId || user.email === userId);
    return findContactForPerson(db, ownerId, userId, [known?.id, known?.email]);
  };
  const identityFor = (userId) => {
    const id = String(userId || "");
    const known = directoryUsers().find((user) => user.id === id || user.email === id);
    return findIdentity(db, id, [known?.id, known?.email].filter(Boolean));
  };
  const displayNameFor = (userId, viewerId) => {
    const contact = contactForPerson(viewerId, userId);
    const nick = String(contact?.nickname ?? "").trim();
    if (nick) {
      return nick;
    }
    const identity = identityFor(userId);
    const fromIdentity = [identity?.firstName, identity?.lastName].filter(Boolean).join(" ").trim();
    if (fromIdentity) {
      return fromIdentity;
    }
    const named = personNameOf(contact);
    if (named) {
      return named;
    }
    const id = String(userId || "");
    const known = directoryUsers().find((user) => user.id === id || user.email === id);
    if (known) {
      return [known.firstName, known.lastName].filter(Boolean).join(" ").trim() || known.name;
    }
    return id;
  };
  const pictureFor = (userId, viewerId) => {
    const contact = contactForPerson(viewerId, userId);
    if (contact?.picture) {
      return contact.picture;
    }
    return identityFor(userId)?.picture || "";
  };
  const withPeopleNames = (event, viewerId) => {
    const nameOf = (id) => displayNameFor(id, viewerId);
    return {
      ...event,
      participants: (event.participants ?? []).map((item) => {
        const identity = identityFor(item.userId);
        const contact = contactForPerson(viewerId, item.userId);
        return {
          ...item,
          name: nameOf(item.userId),
          firstName: contact?.firstName || identity?.firstName || "",
          lastName: contact?.lastName || identity?.lastName || "",
          picture: pictureFor(item.userId, viewerId),
        };
      }),
      invitees: (event.invitees ?? []).map((item) => ({
        ...item,
        name: nameOf(item.userId),
        picture: pictureFor(item.userId, viewerId),
      })),
    };
  };
  const personById = (userId, ownerId = "") => {
    const id = String(userId || "");
    const known = directoryUsers().find((user) => user.id === id || user.email === id);
    const contact = contactForPerson(ownerId, id);
    const identity = identityFor(id);
    const email = known?.email || identity?.email || (isEmail(id) ? id.toLowerCase() : "");
    const named =
      correspondenceName({
        firstName: contact?.firstName || identity?.firstName || known?.firstName,
        lastName: contact?.lastName || identity?.lastName || known?.lastName,
        nickname: contact?.nickname,
        name: known?.name,
        email,
      }) ||
      personNameOf(contact) ||
      [identity?.firstName, identity?.lastName].filter(Boolean).join(" ").trim();
    const fallback = known
      ? [known.firstName, known.lastName].filter(Boolean).join(" ").trim() || known.name
      : isEmail(id)
        ? id.split("@")[0]
        : id;
    return {
      id: known?.id || id,
      name: named || fallback,
      email,
      nickname: contact?.nickname || "",
      firstName: contact?.firstName || identity?.firstName || known?.firstName || "",
      lastName: contact?.lastName || identity?.lastName || known?.lastName || "",
      picture: contact?.picture || identity?.picture || "",
    };
  };
  const resolveInviteeId = (raw) => {
    const value = String(raw ?? "").trim().toLowerCase();
    const known = directoryUsers().find((user) => user.id === value || user.email === value);
    return known ? known.id : value;
  };
  const resolveInviteeIds = (ids) => [...new Set((ids ?? []).map(resolveInviteeId).filter(Boolean))];
  const emailsForInvitees = (ids) =>
    ids.map((id) => personById(id).email || (isEmail(id) ? id : "")).filter(Boolean);
  const rememberInvitees = (ownerId, ids) => {
    ensureContactsForEmails(db, ownerId, emailsForInvitees(ids), { max: maxEntries });
  };
  const appUrl = String(environment.APP_URL || "").trim() || "/";
  const maxEntries = maxContacts(environment);
  const mail =
    mailer ??
    createMailer({
      env: environment,
      standalone: ctx.standalone,
      templatesDir: templatesDir ?? defaultTemplatesDir,
    });
  const db = openDatabase(dataDir);
  initializeEventsStore(db, {
    dataDir,
    examplePath,
    knownUserIds: directoryIds(),
    seedExample: ctx.standalone,
  });
  app.locals.db = db;
  app.locals.mailer = mail;
  app.use("/api", (req, _res, next) => {
    const user = ctx.user(req);
    if (user) {
      rememberIdentity(db, user);
    }
    next();
  });
  const sendDigest = (options = {}) =>
    sendDailyAdminDigest({ db, mailer: mail, ctx, env: environment, ...options });
  app.locals.sendDailyDigest = sendDigest;
  let digestTimer = null;
  if (scheduleDigest) {
    digestTimer = setInterval(() => {
      sendDigest().catch((err) => {
        console.error("daily digest failed:", err instanceof Error ? err.message : err);
      });
    }, 15 * 60 * 1000);
    digestTimer.unref?.();
  }
  app.locals.stopMailJobs = () => {
    if (digestTimer) {
      clearInterval(digestTimer);
      digestTimer = null;
    }
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const user = ctx.user(req);
    res.json({
      mode: ctx.mode,
      user: user ? publicUser(user) : null,
      source: user?.source ?? null,
      canSwitchUser: ctx.standalone,
      inviteMode: ctx.embedded ? "email" : "directory",
      maxContacts: maxEntries,
    });
  });

  app.get("/api/users", (_req, res) => {
    if (ctx.embedded) {
      res.json({ users: [], inviteMode: "email" });
      return;
    }
    try {
      const users = usersFromConfig(ctx.config()).map(({ id, name, email, firstName, lastName }) => ({
        id,
        name,
        email,
        firstName,
        lastName,
      }));
      res.json({ users, inviteMode: "directory" });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid config" });
    }
  });

  app.get("/api/contacts", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    res.json({ contacts: listContacts(db, user.id), max: maxEntries });
  });

  app.post("/api/contacts", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const contact = createContact(db, user.id, req.body, { max: maxEntries });
      res.status(201).json({ contact });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not create contact" });
    }
  });

  app.get("/api/contacts/:id", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    const contact = loadContact(db, user.id, req.params.id);
    if (!contact) {
      res.status(404).json({ error: "contact not found" });
      return;
    }
    res.json({ contact });
  });

  app.put("/api/contacts/:id", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const contact = updateContact(db, user.id, req.params.id, req.body);
      res.json({ contact });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not update contact" });
    }
  });

  app.delete("/api/contacts/:id", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      deleteContact(db, user.id, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not delete contact" });
    }
  });

  app.get("/api/events", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      res.json({ events: eventsForUser(loadEvents(db), user).map((event) => withPeopleNames(event, user.id)) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid events" });
    }
  });

  app.post("/api/events", async (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = createEvent({
        id: allocateEventId(db),
        name: req.body?.name,
        title: req.body?.title,
        description: req.body?.description,
        venue: req.body?.venue,
        durationMinutes: req.body?.durationMinutes,
        createdBy: user.id,
        inviteeIds: resolveInviteeIds(req.body?.inviteeIds),
        knownUserIds: directoryIds(),
        date: req.body?.date,
        start: req.body?.start,
        end: req.body?.end,
      });
      const saved = saveEvent(db, event);
      rememberInvitees(user.id, saved.inviteeIds);
      logActivity(db, {
        type: "event_created",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} created ${saved.name}`,
      });
      res.status(201).json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid event" });
    }
  });

  app.get("/api/events/:id", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      res.json({ event: withPeopleNames(event, user.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid events" });
    }
  });

  app.put("/api/events/:id", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      updateEvent(event, {
        name: req.body?.name,
        title: req.body?.title,
        description: req.body?.description,
        venue: req.body?.venue,
        durationMinutes: req.body?.durationMinutes,
        date: req.body?.date,
        start: req.body?.start,
        inviteeIds: req.body?.inviteeIds != null ? resolveInviteeIds(req.body.inviteeIds) : undefined,
        knownUserIds: directoryIds(),
        userId: user.id,
      });
      const saved = saveEvent(db, event);
      rememberInvitees(user.id, saved.inviteeIds);
      logActivity(db, {
        type: "event_updated",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} updated ${saved.name}`,
      });
      res.json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not update event" });
    }
  });

  app.post("/api/events/:id/participants", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      addInvitees(event, {
        inviteeIds: resolveInviteeIds(req.body?.inviteeIds),
        knownUserIds: directoryIds(),
        userId: user.id,
      });
      const saved = saveEvent(db, event);
      rememberInvitees(user.id, saved.inviteeIds);
      res.status(201).json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not add participants" });
    }
  });

  app.delete("/api/events/:id/participants/:userId", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      removeInvitee(event, { inviteeId: req.params.userId, userId: user.id });
      const saved = saveEvent(db, event);
      res.json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not remove participant" });
    }
  });

  app.post("/api/events/:id/invitations", async (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (event.createdBy !== user.id) {
        res.status(403).json({ error: "only the creator can send invitations" });
        return;
      }
      const update = Boolean(req.body?.update);
      const pending = pendingInvitees(event);
      const previously = update ? notifiedInvitees(event) : [];
      if (!pending.length && !previously.length) {
        res.status(400).json({ error: update ? "no participants to update" : "no pending invitations" });
        return;
      }
      const sentIds = [];
      const deliver = async (list, isUpdate) => {
        if (!list.length) {
          return;
        }
        const sent = await sendEventInvitations({
          mailer: mail,
          event,
          creator: user,
          invitees: list.map((item) => ({ ...personById(item.userId, event.createdBy), userId: item.userId })),
          appUrl: eventPageUrl(appUrl, event.id),
          update: isUpdate,
        });
        for (const item of sent) {
          if (item.skipped) {
            continue;
          }
          sentIds.push(item.userId);
          logActivity(db, {
            type: "invite_sent",
            actorId: user.id,
            eventId: event.id,
            summary: `${isUpdate ? "Updated" : "Invited"} ${item.to.name || item.to.email} for ${event.name}`,
          });
        }
      };
      let mailError = null;
      try {
        await deliver(pending, false);
        await deliver(previously, true);
      } catch (err) {
        mailError = err;
        console.error("invitation email failed:", err instanceof Error ? err.message : err);
      }
      if (sentIds.length) {
        markInviteesNotified(event, sentIds);
      }
      const saved = withPeopleNames(saveEvent(db, event), user.id);
      if (mailError || !sentIds.length) {
        const detail = mailError
          ? mailDeliveryMessage(mailError)
          : "No invitation email was sent. Check mail configuration and that each invitee has an email address.";
        const extra = sentIds.length ? ` ${sentIds.length} invitation(s) were sent before the error.` : "";
        res.status(502).json({ error: `${detail}${extra}`, event: saved, sent: sentIds.length, update });
        return;
      }
      res.json({ event: saved, sent: sentIds.length, update });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not send invitations" });
    }
  });

  app.post("/api/events/:id/slots", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      addSlot(event, { date: req.body?.date, start: req.body?.start, suggestedBy: user.id });
      const saved = saveEvent(db, event);
      const slot = saved.slots.at(-1);
      logActivity(db, {
        type: "slot_added",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} proposed ${slot?.date ?? ""} ${slot?.start ?? ""} for ${saved.name}`,
      });
      res.status(201).json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "invalid slot" });
    }
  });

  app.post("/api/events/:id/slots/:slotId/vote", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      const before = event.votes.length;
      toggleVote(event, { slotId: req.params.slotId, userId: participantKey(event, user) });
      const saved = saveEvent(db, event);
      logActivity(db, {
        type: saved.votes.length > before ? "vote_cast" : "vote_removed",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} ${saved.votes.length > before ? "voted on" : "removed a vote from"} ${saved.name}`,
      });
      res.json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "invalid vote" });
    }
  });

  app.post("/api/events/:id/accept", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      acceptInvitee(event, participantKey(event, user));
      const saved = saveEvent(db, event);
      logActivity(db, {
        type: "invite_accepted",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} accepted ${saved.name}`,
      });
      res.json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not accept" });
    }
  });

  app.post("/api/events/:id/lock", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      lockSlot(event, { slotId: req.body?.slotId, userId: user.id });
      const saved = saveEvent(db, event);
      logActivity(db, {
        type: "event_confirmed",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} confirmed ${saved.name}`,
      });
      res.json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not lock" });
    }
  });

  app.delete("/api/events/:id/slots/:slotId", (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      deleteSlot(event, { slotId: req.params.slotId, userId: user.id });
      const saved = saveEvent(db, event);
      logActivity(db, {
        type: "slot_deleted",
        actorId: user.id,
        eventId: saved.id,
        summary: `${correspondenceName(user, user.id)} deleted a slot from ${saved.name}`,
      });
      res.json({ event: withPeopleNames(saved, user.id) });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not delete slot" });
    }
  });

  app.delete("/api/events/:id", async (req, res) => {
    const user = requireUser(req, res, ctx);
    if (!user) {
      return;
    }
    try {
      const event = loadEvent(db, req.params.id);
      if (!event) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      if (!isParticipant(event, user)) {
        res.status(403).json({ error: "not a participant" });
        return;
      }
      const eventName = event.name;
      const eventId = event.id;
      const notify = Boolean(req.body?.notify);
      let sent = 0;
      if (notify) {
        const recipients = cancellationRecipients(event);
        try {
          const results = await sendEventCancellations({
            mailer: mail,
            event,
            creator: user,
            invitees: recipients.map((item) => ({ ...personById(item.userId, event.createdBy), userId: item.userId })),
            appUrl,
          });
          for (const item of results) {
            if (item.skipped) {
              continue;
            }
            sent += 1;
            logActivity(db, {
              type: "invite_cancelled",
              actorId: user.id,
              eventId,
              summary: `Cancelled ${item.to.name || item.to.email} for ${eventName}`,
            });
          }
        } catch (err) {
          console.error("cancellation email failed:", err instanceof Error ? err.message : err);
          res.status(502).json({ error: mailDeliveryMessage(err) });
          return;
        }
        if (recipients.length && !sent) {
          res.status(502).json({
            error: "Cancellation email was not sent. Check mail configuration, or delete without sending emails.",
          });
          return;
        }
      }
      deleteStoredEvent(db, event, { userId: user.id });
      logActivity(db, {
        type: "event_deleted",
        actorId: user.id,
        eventId,
        summary: `${correspondenceName(user, user.id)} deleted ${eventName}`,
      });
      res.json({ ok: true, sent });
    } catch (err) {
      res.status(httpError(err)).json({ error: err instanceof Error ? err.message : "could not delete event" });
    }
  });

  app.use(express.static(publicDir));
  app.get(["/", "/events/:id"], (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
