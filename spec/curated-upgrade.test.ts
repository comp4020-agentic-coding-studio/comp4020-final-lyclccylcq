import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURATED, CURATED_VERSION } from "../src/curated.ts";
import { client, startApp, signUp } from "./helpers.ts";

// A database that already runs (an older CURATED_VERSION) gets the new
// curated plans when the app next starts: nothing is emptied, a person's
// trips and publications stay as they were, a place id already matched is
// kept, and starting again adds nothing twice. This is the path production
// takes on deploy (server.ts seeds on every start).
const NEW = ["tpl-lake-brienz-giessbach", "tpl-male-hulhumale-local"];

describe("upgrading an existing database's curated plans", () => {
  let app: Awaited<ReturnType<typeof startApp>> | null = null;
  // the app is stopped even when a check fails, so no server is left running
  afterEach(() => app?.stop());
  it("adds the new plans, keeps people's trips and matched places, and repeats harmlessly", async () => {
    // a database as an older version left it, with someone's data in it
    app = await startApp();
    const dataDir = app.dataDir;
    let c = await signUp(app.url);
    const copied = await c.send("POST", "/api/itineraries/tpl-sydney-harbour-highlights/copy", { startDate: "2026-12-05" });
    expect(copied.status).toBe(201);
    const tripId = copied.data.id;
    expect(tripId).toBeTruthy();
    const before = (await c.send("GET", `/api/trips/${tripId}`)).data;
    const pub = await c.send("PUT", `/api/trips/${tripId}/publication`, { description: "Kept as it was", visibility: "link" });
    expect(pub.status).toBe(201);
    await app.stop();
    {
      const db = new DatabaseSync(join(dataDir, "wayline.db"));
      db.exec("pragma foreign_keys = on");
      // as version 2 had it: not yet the two new plans, every other one at 2
      for (const id of NEW) db.prepare("delete from itinerary_templates where id = ?").run(id);
      db.prepare("update itinerary_templates set content_version = 2").run();
      // a place Google had matched for an unchanged stop
      db.prepare("update itinerary_template_stops set place_id = 'ChIJ-matched-earlier' where id = 'tpl-sydney-harbour-highlights-s1'").run();
      expect((db.prepare("select count(*) n from itinerary_templates").get() as any).n).toBe(CURATED.length - NEW.length);
      db.close();
    }

    // the new version starts on it (same session, kept in the database)
    app = await startApp({}, dataDir);
    c = client(app.url, c.cookie, c.userId);
    const look = () => {
      const db = new DatabaseSync(join(dataDir, "wayline.db"), { readOnly: true });
      const r = {
        templates: (db.prepare("select count(*) n from itinerary_templates").get() as any).n,
        stops: (db.prepare("select count(*) n from itinerary_template_stops").get() as any).n,
        versions: db.prepare("select distinct content_version v from itinerary_templates").all().map((x: any) => x.v),
        matched: (db.prepare("select place_id from itinerary_template_stops where id = 'tpl-sydney-harbour-highlights-s1'").get() as any).place_id,
        users: (db.prepare("select count(*) n from users").get() as any).n,
        trips: (db.prepare("select count(*) n from trips").get() as any).n,
        publications: (db.prepare("select count(*) n from trip_publications").get() as any).n,
      };
      db.close();
      return r;
    };
    const once = look();
    expect(once.templates).toBe(CURATED.length);
    expect(once.versions).toEqual([CURATED_VERSION]);
    expect(once.matched).toBe("ChIJ-matched-earlier");
    expect(once).toMatchObject({ users: 1, trips: 1, publications: 1 });
    // the two new plans answer, with their stops
    for (const id of NEW) {
      const it = await c.send("GET", `/api/itineraries/${id}`);
      expect(it.status, id).toBe(200);
      expect(it.data.stops.length, id).toBeGreaterThan(3);
    }
    // the person's copied trip and its publication are as they were
    const after = (await c.send("GET", `/api/trips/${tripId}`)).data;
    expect(after.title).toBe(before.title);
    expect(after.days.flatMap((d: any) => d.activities).map((a: any) => [a.title, a.startMin])).toEqual(before.days.flatMap((d: any) => d.activities).map((a: any) => [a.title, a.startMin]));
    const kept = (await c.send("GET", `/api/trips/${tripId}/publication`)).data.publication;
    expect(kept).toMatchObject({ id: pub.data.publication.id, description: "Kept as it was" });
    await app.stop();

    // starting again changes nothing
    app = await startApp({}, dataDir);
    expect(look()).toEqual(once);
  });
});
