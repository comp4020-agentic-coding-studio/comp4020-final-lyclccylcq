import type { ServerResponse } from "node:http";

// Live trip updates over server-sent events. Each open editor holds one
// stream; after every committed change the server sends the whole trip
// snapshot to everyone watching that trip. The trip is small, and sending
// the authoritative state (rather than a diff to merge) means a client can't
// drift: the newest revision it has seen is what the server has.
//
// The hub is in memory, which holds because Fly runs exactly one machine for
// this app. A second machine would need a shared channel (see ADR 0003).

// view: where this tab's map is looking (centre, zoom, heading), shared with
// the other people on the trip so they can see where everyone is exploring.
// It's the map view only (never the device's location), lives in memory with
// the stream, and is never written to the database or counted as a revision.
export type MapView = { lat: number; lng: number; zoom: number; heading: number; at: number };
type Conn = { userId: string; displayName: string; session: string | null; view: MapView | null; res: ServerResponse };
const VIEW_TTL_MS = 60_000;
const VIEW_MIN_GAP_MS = 150;

// Voice-call signalling rides on these streams as targeted `call` events
// (src/calls.ts): sent to one person's tabs, never to the room, never saved.
export type HubHooks = {
  onJoin?: (tripId: string, userId: string, session: string | null) => void;
  onLeave?: (tripId: string, userId: string, session: string | null) => void;
};

export function createHub(hooks: HubHooks = {}) {
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
  const viewEvent = (c: Conn) => ({ session: c.session, userId: c.userId, displayName: c.displayName, ...c.view });
  const toOthers = (tripId: string, from: Conn, event: string, data: unknown) => {
    for (const o of rooms.get(tripId) ?? []) if (o !== from) write(o, event, data);
  };

  const heartbeat = setInterval(() => {
    for (const [tripId, room] of rooms) {
      for (const c of room) {
        c.res.write(": keep-alive\n\n");
        // a view nobody has moved for a minute is stale
        if (c.view && Date.now() - c.view.at > VIEW_TTL_MS) {
          c.view = null;
          toOthers(tripId, c, "view-gone", { session: c.session });
        }
      }
    }
  }, 20_000);
  heartbeat.unref();

  return {
    join(tripId: string, user: { id: string; displayName: string }, res: ServerResponse, initial: unknown, session: string | null = null): void {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write("retry: 2000\n\n");
      const conn: Conn = { userId: user.id, displayName: user.displayName, session, view: null, res };
      if (!rooms.has(tripId)) rooms.set(tripId, new Set());
      rooms.get(tripId)?.add(conn);
      write(conn, "snapshot", initial);
      // where the others are looking right now, so a (re)joining tab sees them at once
      for (const o of rooms.get(tripId) ?? []) if (o !== conn && o.view && Date.now() - o.view.at < VIEW_TTL_MS) write(conn, "view", viewEvent(o));
      announcePresence(tripId);
      hooks.onJoin?.(tripId, user.id, session);
      res.on("close", () => {
        const room = rooms.get(tripId);
        if (!room?.delete(conn)) return; // already removed by publish()
        if (conn.view) toOthers(tripId, conn, "view-gone", { session: conn.session });
        if (room.size === 0) rooms.delete(tripId);
        else announcePresence(tripId);
        hooks.onLeave?.(tripId, conn.userId, conn.session);
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
          room.delete(c);
          c.res.end();
          hooks.onLeave?.(tripId, c.userId, c.session);
        } else {
          c.res.write(`event: snapshot\ndata: ${payload}\n\n`);
        }
      }
      announcePresence(tripId);
    },

    presence,

    // Sends an event to one person's open tabs on a trip (one tab when
    // session is given). Returns how many streams it reached.
    sendTo(tripId: string, userId: string, session: string | null, event: string, data: unknown): number {
      let n = 0;
      for (const c of rooms.get(tripId) ?? []) {
        if (c.userId !== userId || (session !== null && c.session !== session)) continue;
        write(c, event, data);
        n++;
      }
      return n;
    },

    hasSession(tripId: string, userId: string, session: string): boolean {
      return [...(rooms.get(tripId) ?? [])].some((c) => c.userId === userId && c.session === session);
    },

    isOnline(tripId: string, userId: string): boolean {
      return [...(rooms.get(tripId) ?? [])].some((c) => c.userId === userId && c.session !== null);
    },

    // A tab's map moved: remember it on that tab's stream and tell the others.
    // Updates closer together than VIEW_MIN_GAP_MS are dropped (the browser
    // already throttles; this caps a misbehaving one). Returns false when the
    // tab has no open stream on this trip.
    setView(tripId: string, userId: string, session: string, view: Omit<MapView, "at">): boolean {
      const conn = [...(rooms.get(tripId) ?? [])].find((c) => c.userId === userId && c.session === session);
      if (!conn) return false;
      if (conn.view && Date.now() - conn.view.at < VIEW_MIN_GAP_MS) return true;
      conn.view = { ...view, at: Date.now() };
      toOthers(tripId, conn, "view", viewEvent(conn));
      return true;
    },

    closeAll(): void {
      clearInterval(heartbeat);
      for (const room of rooms.values()) for (const c of room) c.res.end();
      rooms.clear();
    },
  };
}
