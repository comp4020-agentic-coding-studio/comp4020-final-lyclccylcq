import type { ServerResponse } from "node:http";

// Live trip updates over server-sent events. Each open editor holds one
// stream; after every committed change the server sends the whole trip
// snapshot to everyone watching that trip. The trip is small, and sending
// the authoritative state (rather than a diff to merge) means a client can't
// drift: the newest revision it has seen is what the server has.
//
// The hub is in memory, which holds because Fly runs exactly one machine for
// this app. A second machine would need a shared channel (see ADR 0003).

type Conn = { userId: string; displayName: string; res: ServerResponse };

export function createHub() {
  const rooms = new Map<string, Set<Conn>>();

  const write = (c: Conn, event: string, data: unknown) => {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  function presence(tripId: string): { id: string; displayName: string }[] {
    const seen = new Map<string, string>();
    for (const c of rooms.get(tripId) ?? []) seen.set(c.userId, c.displayName);
    return [...seen].map(([id, displayName]) => ({ id, displayName }));
  }

  const announcePresence = (tripId: string) => {
    const people = presence(tripId);
    for (const c of rooms.get(tripId) ?? []) write(c, "presence", people);
  };

  // Fly's proxy drops a connection that's silent for a minute.
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) for (const c of room) c.res.write(": keep-alive\n\n");
  }, 20_000);
  heartbeat.unref();

  return {
    join(tripId: string, user: { id: string; displayName: string }, res: ServerResponse, initial: unknown): void {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write("retry: 2000\n\n");
      const conn: Conn = { userId: user.id, displayName: user.displayName, res };
      if (!rooms.has(tripId)) rooms.set(tripId, new Set());
      rooms.get(tripId)?.add(conn);
      write(conn, "snapshot", initial);
      announcePresence(tripId);
      res.on("close", () => {
        const room = rooms.get(tripId);
        room?.delete(conn);
        if (room && room.size === 0) rooms.delete(tripId);
        else announcePresence(tripId);
      });
    },

    // Sends the new snapshot to everyone still allowed to see the trip; a
    // stream whose user has been removed is told so and closed.
    publish(tripId: string, snapshot: unknown | null, isMember: (userId: string) => boolean): void {
      const room = rooms.get(tripId);
      if (!room) return;
      const payload = JSON.stringify(snapshot);
      for (const c of [...room]) {
        if (snapshot === null || !isMember(c.userId)) {
          write(c, "revoked", { reason: snapshot === null ? "deleted" : "removed" });
          c.res.end();
          room.delete(c);
        } else {
          c.res.write(`event: snapshot\ndata: ${payload}\n\n`);
        }
      }
      announcePresence(tripId);
    },

    presence,

    closeAll(): void {
      clearInterval(heartbeat);
      for (const room of rooms.values()) for (const c of room) c.res.end();
      rooms.clear();
    },
  };
}
