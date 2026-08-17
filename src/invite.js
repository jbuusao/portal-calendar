export function simulateInvites(eventId, inviteeIds) {
  const at = new Date().toISOString();
  return inviteeIds.map((userId) => ({ eventId, userId, at }));
}
