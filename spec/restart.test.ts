import { describe, expect, it } from "vitest";
import { addActivity, logIn, newTrip, signUp, startApp } from "./helpers.ts";

// What the shared app under test can't show: a real restart, and how the
// server behaves with particular configuration. Each starts its own copy of
// the app on its own port and database.

describe("persistence and configuration", () => {
  it("keeps accounts, trips and itineraries across a restart, and sessions too", async () => {
    let app = await startApp();
    const name = `restart${Date.now().toString(36)}`;
    const c = await signUp(app.url, name);
    const trip = await newTrip(c, { title: "Survives" });
    await addActivity(c, trip, { title: "Harbour walk", notes: "Bring a hat" });
    await app.stop();

    app = await startApp({}, app.dataDir);
    try {
      const sameCookie = { ...c, get: (p: string) => fetch(new URL(p, app.url), { headers: { cookie: c.cookie } }).then(async (r) => ({ status: r.status, data: await r.json() })) };
      expect((await sameCookie.get("/api/auth/me")).status).toBe(200);
      const again = await logIn(app.url, name);
      const t = (await again.get(`/api/trips/${trip.id}`)).data;
      expect(t.title).toBe("Survives");
      expect(t.days[0].activities[0]).toMatchObject({ title: "Harbour walk", notes: "Bring a hat" });
    } finally {
      await app.stop();
    }
  });

  it("never sends server-side keys to the browser", async () => {
    const app = await startApp({
      GOOGLE_MAPS_SERVER_KEY: "server-side-maps-secret-value",
      ANTHROPIC_API_KEY: "server-side-ai-secret-value",
      GOOGLE_MAPS_BROWSER_KEY: "browser-key-meant-to-be-public",
    });
    try {
      const pages = await Promise.all(["/api/config", "/", "/app.js", "/editor.js", "/map.js", "/ui.js", "/readme/"].map((p) => fetch(new URL(p, app.url)).then((r) => r.text())));
      const all = pages.join("\n");
      expect(all).not.toContain("server-side-maps-secret-value");
      expect(all).not.toContain("server-side-ai-secret-value");
      const config = JSON.parse(pages[0]);
      expect(Object.keys(config).sort()).toEqual(["ai", "mapId", "mapsBrowserKey", "places", "routes"]);
      expect(config).toMatchObject({ mapsBrowserKey: "browser-key-meant-to-be-public", places: "google", routes: true, ai: { configured: true } });
    } finally {
      await app.stop();
    }
  });

  it("without Google configured: labelled demo places, and no invented routes", async () => {
    const app = await startApp();
    try {
      const c = await signUp(app.url);
      const trip = await newTrip(c);
      const search = (await c.get(`/api/places/search?q=zoo&tripId=${trip.id}`)).data;
      expect(search.source).toBe("demo");
      expect(search.places.every((p: any) => p.source === "demo" && p.placeId.startsWith("demo:"))).toBe(true);
      const details = (await c.get(`/api/places/${encodeURIComponent(search.places[0].placeId)}`)).data;
      expect(details.openingHours).toBeNull();

      const place = (p: any) => ({ placeId: p.placeId, source: "demo", lat: p.lat, lng: p.lng });
      const a = (await addActivity(c, trip, { place: place(search.places[0]) })).data.activityId;
      const b = (await addActivity(c, trip, { startMin: 720, place: place(search.places[0]) })).data.activityId;
      const res = await c.send("POST", `/api/trips/${trip.id}/routes`, { fromId: a, toId: b });
      expect(res.status).toBe(503);
      expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].segments).toEqual([]);
    } finally {
      await app.stop();
    }
  });
});
