/** Record-only in this repo. Portal keeps this write and sends email from the same payload. */
export function simulateInvites(eventId, inviteeIds) {
  const at = new Date().toISOString();
  return inviteeIds.map((userId) => ({ eventId, userId, at }));
}

