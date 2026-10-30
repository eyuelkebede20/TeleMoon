import { getJournalHead } from "./db.js";

/**
 * In-memory registry of active Server-Sent Event (SSE) clients by userId.
 * userId -> Set of Express response objects
 */
const clientsByUser = new Map();

/**
 * Register an active SSE response.
 */
export function addSSEClient(userId, res) {
  if (!clientsByUser.has(userId)) {
    clientsByUser.set(userId, new Set());
  }
  clientsByUser.get(userId).add(res);

  res.on("close", () => {
    const set = clientsByUser.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        clientsByUser.delete(userId);
      }
    }
  });
}

/**
 * Broadcast a change notification hint to all connected clients for a user.
 */
export function emitSyncChange(userId, cursor) {
  const targets = new Set();

  const userClients = clientsByUser.get(userId);
  if (userClients) {
    for (const res of userClients) targets.add(res);
  }

  // Also notify 'system' listeners if any
  const sysClients = clientsByUser.get("system");
  if (sysClients && userId !== "system") {
    for (const res of sysClients) targets.add(res);
  }

  const payload = `event: change\nid: ${cursor}\ndata: ${JSON.stringify({ cursor })}\n\n`;
  for (const res of targets) {
    try {
      res.write(payload);
    } catch (e) {
      console.error("[sse write error]", e.message);
    }
  }
}

/**
 * Heartbeat timer: runs every 25 seconds to keep HTTP connections alive through proxies.
 */
setInterval(() => {
  const comment = `: heartbeat\n\n`;
  for (const set of clientsByUser.values()) {
    for (const res of set) {
      try {
        res.write(comment);
      } catch (_) {}
    }
  }
}, 25000);
