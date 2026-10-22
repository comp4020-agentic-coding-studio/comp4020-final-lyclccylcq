import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, inject, it } from "vitest";
import { anon, client, logIn, newTrip, share, signUp, startApp, uniqueName, watchEvents } from "./helpers.ts";

// Usernames and display names are each unique (README, "Accounts"). A
// display name is compared by its normalised key (NFKC, trimmed, inner
// spaces collapsed, Unicode lower case), and the database enforces both.
const baseUrl = inject("baseUrl");
const PW = "correct horse battery";

async function signup(username: string, displayName: string, url = baseUrl) {
  const res = await fetch(new URL("/api/auth/signup", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW, displayName }) });
  return { status: res.status, data: (await res.json()) as any, cookie: res.headers.get("set-cookie") };
}

describe("unique names at registration", () => {
  it("refuses a taken username or display name, with a field-specific message and no session", async () => {
    const base = uniqueName("dup");
    const first = await signup(base, `Name ${base}`);
    expect(first.status).toBe(201);

    const sameUser = await signup(base.toUpperCase(), `Other ${base}`);
    expect(sameUser).toMatchObject({ status: 409, data: { error: "That username is already taken.", field: "username" }, cookie: null });
    const spaced = await signup(`  ${base} `, `Other2 ${base}`);
    expect(spaced.data.field).toBe("username");

    for (const variant of [`name ${base}`, `  NAME ${base.toUpperCase()}  `, `Name   ${base}`, `Ｎａｍｅ ${base}`]) {
      const r = await signup(uniqueName("x"), variant);
      expect(r, variant).toMatchObject({ status: 409, data: { error: "That display name is already taken.", field: "displayName" }, cookie: null });
    }
  });

  it("keeps Chinese and other Unicode names as typed, and compares them by the same key", async () => {
    const tag = uniqueName("").slice(-6);
    const name = `陈小明${tag}`;
    const ok = await signup(uniqueName("cn"), ` ${name} `);
    expect(ok.status).toBe(201);
    expect(ok.data.user.displayName).toBe(name); // trimmed, otherwise as typed
    expect((await signup(uniqueName("cn"), name)).data.field).toBe("displayName");
    // case folding beyond ASCII: Ä/ä, Σ/σ
    expect((await signup(uniqueName("de"), `Äsa ${tag}`)).status).toBe(201);
    expect((await signup(uniqueName("de"), `äSA ${tag}`)).data.field).toBe("displayName");
    // 40 characters, counted as characters, fit; 41 don't
    expect((await signup(uniqueName("ln"), "旅".repeat(34) + tag)).status).toBe(201);
    expect((await signup(uniqueName("ln"), "旅".repeat(35) + tag)).status).toBe(400);
    // invisible characters can't make a look-alike of an existing name
    expect((await signup(uniqueName("zw"), `陈小​明${tag}`)).status).toBe(400);
  });

  it("lets exactly one of two simultaneous sign-ups with the same names succeed", async () => {
    const username = uniqueName("race");
    const displayName = `Racer ${username}`;
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => signup(i % 2 ? username : username.toUpperCase(), displayName)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409).every((r) => r.cookie === null)).toBe(true);
    // same display name, different usernames: still one winner
    const dn = `Racer two ${username}`;
    const second = await Promise.all(Array.from({ length: 6 }, () => signup(uniqueName("r2"), dn)));
    expect(second.filter((r) => r.status === 201)).toHaveLength(1);
    expect(second.filter((r) => r.status === 409).every((r) => r.data.field === "displayName")).toBe(true);
  });

  it("answers availability for the form, while the insert stays the final say", async () => {
    const c = await signUp(baseUrl);
    const me = (await c.get("/api/auth/me")).data.user;
    const free = await anon(baseUrl).get(`/api/auth/available?username=${uniqueName("free")}&displayName=${encodeURIComponent(uniqueName("Free"))}`);
    expect(free.data).toEqual({ username: true, displayName: true });
    const taken = await anon(baseUrl).get(`/api/auth/available?username=${me.username.toUpperCase()}&displayName=${encodeURIComponent(` ${me.displayName.toUpperCase()} `)}`);
    expect(taken.data).toEqual({ username: false, displayName: false });
  });

  it("still signs in with any case and outer spaces, keeps the user id, and signs out", async () => {
    const name = uniqueName("login");
    const created = await signup(name, `Login ${name}`);
    const again = await logIn(baseUrl, `  ${name.toUpperCase()} `);
    expect(again.userId).toBe(created.data.user.id);
    expect((await again.get("/api/auth/me")).data.user.username).toBe(name);
    expect((await again.send("POST", "/api/auth/logout", {})).status).toBe(200);
    expect((await again.get("/api/auth/me")).status).toBe(401);
  });
});

describe("existing accounts when display names became unique", () => {
  it("fills keys, waits with the index on a collision without renaming anyone, still refuses new duplicates, and finishes once resolved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wayline-names-"));
    const old = new DatabaseSync(join(dir, "wayline.db"));
    old.exec("create table users (id text primary key, username text not null unique collate nocase, display_name text not null, password_hash text not null, created_at integer not null)");
    const ins = old.prepare("insert into users values (?, ?, ?, 'x', 0)");
    ins.run("u1", "anna1", "Anna");
    ins.run("u2", "anna2", " ANNA ");
    ins.run("u3", "chen", "陈小明");
    old.close();

    let app = await startApp({}, dir);
    try {
      const look = () => {
        const d = new DatabaseSync(join(dir, "wayline.db"), { readOnly: true });
        const rows = d.prepare("select id, display_name, display_name_key from users where id in ('u1','u2','u3') order by id").all().map((r) => ({ ...r }));
        const index = Boolean(d.prepare("select 1 from sqlite_master where name = 'users_display_name_key'").get());
        d.close();
        return { rows, index };
      };
      const before = look();
      expect(before.index).toBe(false);
      expect(before.rows).toEqual([
        { id: "u1", display_name: "Anna", display_name_key: null },
        { id: "u2", display_name: " ANNA ", display_name_key: null },
        { id: "u3", display_name: "陈小明", display_name_key: "陈小明" },
      ]);
      expect((await signup("newanna", "anna", app.url)).data.field).toBe("displayName");
      expect((await signup("newchen", "陈小明", app.url)).data.field).toBe("displayName");
      expect((await signup("newben", "Ben", app.url)).status).toBe(201);

      // someone resolves it (here directly; Wayline has no rename yet), then a restart finishes the migration
      await app.stop();
      const fix = new DatabaseSync(join(dir, "wayline.db"));
      fix.prepare("update users set display_name = 'Anna B' where id = 'u2'").run();
      fix.close();
      app = await startApp({}, dir);
      const after = look();
      expect(after.index).toBe(true);
      expect(after.rows.map((r) => r.display_name_key)).toEqual(["anna", "anna b", "陈小明"]);
      expect((await signup("thirdanna", "ANNA", app.url)).data.field).toBe("displayName");
    } finally {
      await app.stop();
    }
  });
});

describe("inviting an existing account by nickname", () => {
  async function setup() {
    const owner = await signUp(baseUrl);
    const name = uniqueName("guest_");
    const guest = await signUp(baseUrl, name);
    const trip = await newTrip(owner);
    return { owner, guest, name, trip };
  }

  it("searches nicknames for the owner only, exact match first, literal characters, bounded, with each account's status", async () => {
    const { owner, guest, name, trip } = await setup();
    const longer = await signUp(baseUrl, `${name}x`.slice(0, 32));
    const r = await owner.get(`/api/trips/${trip.id}/invitees?q=${name.toUpperCase()}`);
    expect(r.status).toBe(200);
    expect(r.data.results[0]).toEqual({ id: guest.userId, username: name, displayName: name, status: "available" });
    expect(r.data.results.some((x: any) => x.id === longer.userId)).toBe(true);
    expect(Object.keys(r.data.results[0]).sort()).toEqual(["displayName", "id", "status", "username"]); // nothing more
    expect((await owner.get(`/api/trips/${trip.id}/invitees?${new URLSearchParams({ q: `  ${name.toUpperCase()}  ` })}`)).data.results[0].id).toBe(guest.userId);
    // _ is a character here, not a wildcard; % finds nothing
    const under = await owner.get(`/api/trips/${trip.id}/invitees?q=t_`);
    expect(under.data.results.every((x: any) => x.username.toLowerCase().includes("t_"))).toBe(true);
    expect((await owner.get(`/api/trips/${trip.id}/invitees?q=%25%25`)).data.results).toEqual([]);
    expect((await owner.get(`/api/trips/${trip.id}/invitees?q=s`)).data.results).toEqual([]); // one character is exact-only
    expect((await owner.get(`/api/trips/${trip.id}/invitees?q=spec`)).data.results.length).toBeLessThanOrEqual(8);
    // you, and members
    const me = (await owner.get("/api/auth/me")).data.user;
    expect((await owner.get(`/api/trips/${trip.id}/invitees?q=${me.username}`)).data.results[0].status).toBe("you");
    await share(owner, longer, trip.id);
    expect((await owner.get(`/api/trips/${trip.id}/invitees?q=${name}x`)).data.results[0].status).toBe("member");
    // collaborators, outsiders and nobody can't search
    expect((await longer.get(`/api/trips/${trip.id}/invitees?q=${name}`)).status).toBe(403);
    expect((await guest.get(`/api/trips/${trip.id}/invitees?q=${name}`)).status).toBe(404);
    expect((await anon(baseUrl).get(`/api/trips/${trip.id}/invitees?q=${name}`)).status).toBe(401);
  });

  it("finds a previous collaborator by their nickname when their login username is different", async () => {
    const owner = await signUp(baseUrl);
    const username = uniqueName("friend_");
    const displayName = `旅人 ${username.slice(-6)}`;
    const registered = await signup(username, displayName);
    expect(registered.status).toBe(201);
    const guest = client(baseUrl, registered.cookie!.split(";")[0], registered.data.user.id);
    const previous = await newTrip(owner);
    await share(owner, guest, previous.id);
    const trip = await newTrip(owner);
    const result = await owner.get(`/api/trips/${trip.id}/invitees?${new URLSearchParams({ q: displayName })}`);
    expect(result.data.results[0]).toEqual({ id: guest.userId, username, displayName, status: "available" });
    // A login handle is identity information on a result, not the search key.
    expect((await owner.get(`/api/trips/${trip.id}/invitees?q=${username}`)).data.results).toEqual([]);
    const sent = await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: result.data.results[0].id });
    expect(sent.status).toBe(201);
    expect((await owner.get(`/api/trips/${trip.id}/invitees?${new URLSearchParams({ q: displayName })}`)).data.results[0].status).toBe("invited");
  });

  it("normalises nicknames, treats punctuation literally, and puts an exact match ahead of many similar names", async () => {
    const owner = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const tag = uniqueName("").slice(-6);
    const nickname = `Äsa 旅人 ${tag}`;
    const account = await signup(uniqueName("nick"), nickname);
    expect(account.status).toBe(201);
    const search = (q: string) => owner.get(`/api/trips/${trip.id}/invitees?${new URLSearchParams({ q })}`);
    expect((await search(`  ÄSA   旅人 ${tag}  `)).data.results[0].id).toBe(account.data.user.id);
    const fullWidth = nickname.replace(/[A-Za-z0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    expect((await search(fullWidth)).data.results[0].id).toBe(account.data.user.id);
    for (let i = 0; i < 10; i++) expect((await signup(uniqueName("prefix"), `${nickname} ${i}`)).status).toBe(201);
    const exact = await search(nickname);
    expect(exact.data.results).toHaveLength(8);
    expect(exact.data.results[0].id).toBe(account.data.user.id);
    for (const symbol of ["%", "_", "@", "'"]) {
      const text = `${symbol}${tag}`;
      const person = await signup(uniqueName("literal"), text);
      expect(person.status).toBe(201);
      expect((await search(text)).data.results.map((r: any) => r.id)).toEqual([person.data.user.id]);
    }
    const longName = `😀${"旅".repeat(33)}${tag}`; // 40 code points, over 40 UTF-16 units
    expect([...longName]).toHaveLength(40);
    const long = await signup(uniqueName("longnick"), longName);
    expect(long.status).toBe(201);
    expect((await search(longName)).data.results[0].id).toBe(long.data.user.id);
    const expandingName = `${"ﬃ".repeat(34)}${tag}`; // normalised key is longer than the valid 40-character nickname
    const expanding = await signup(uniqueName("expand"), expandingName);
    expect(expanding.status).toBe(201);
    expect((await search(expandingName)).data.results[0].id).toBe(expanding.data.user.id);
    expect((await search("旅".repeat(41))).status).toBe(400);
    expect((await search(" ")).status).toBe(400);
  });

  it("finds one-character and legacy colliding nicknames without changing accounts", async () => {
    const app = await startApp();
    try {
      const owner = await signUp(app.url);
      const trip = await newTrip(owner);
      const single = await signup(uniqueName("single"), "陈", app.url);
      const longer = await signup(uniqueName("longer"), "陈小明", app.url);
      const oldA = await signup(uniqueName("old"), "Legacy Friend", app.url);
      const oldB = await signup(uniqueName("old"), "Legacy Other", app.url);
      const db = new DatabaseSync(join(app.dataDir, "wayline.db"));
      db.prepare("update users set display_name_key = null where id in (?, ?)").run(oldA.data.user.id, oldB.data.user.id);
      db.prepare("update users set display_name = '  LEGACY   FRIEND  ' where id = ?").run(oldB.data.user.id);
      const before = db.prepare("select id, username, display_name, display_name_key from users order by id").all();
      const search = (q: string) => owner.get(`/api/trips/${trip.id}/invitees?${new URLSearchParams({ q })}`);
      expect((await search("陈")).data.results.map((r: any) => r.id)).toEqual([single.data.user.id]);
      expect((await search("陈小")).data.results[0].id).toBe(longer.data.user.id);
      const legacy = await search("Ｌｅｇａｃｙ  friend");
      expect(legacy.data.results.map((r: any) => r.id).sort()).toEqual([oldA.data.user.id, oldB.data.user.id].sort());
      expect(db.prepare("select id, username, display_name, display_name_key from users order by id").all()).toEqual(before);
      db.close();
    } finally { await app.stop(); }
  });

  it("sends an invitation that grants nothing until the right person accepts it, then adds them through the trip's live path", async () => {
    const { owner, guest, trip } = await setup();
    const own = watchEvents(baseUrl, guest, null);
    await own.ready;
    const sent = await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: guest.userId });
    expect(sent.status).toBe(201);
    expect(sent.data.invitation).toMatchObject({ status: "pending", user: { id: guest.userId } });
    // the invitee's own stream says the list changed, with no trip content in it
    const note = await own.next((e) => e.event === "invitations" && e.data.pending === 1);
    expect(note.data).toEqual({ pending: 1, requests: 0 });

    expect((await guest.get(`/api/trips/${trip.id}`)).status).toBe(404); // not a member yet
    expect((await guest.get(`/api/trips/${trip.id}/events`)).status).toBe(404);
    const list = (await guest.get("/api/invitations")).data.invitations;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ trip: { id: trip.id, title: trip.title }, inviter: { id: owner.userId } });

    // someone else can't accept it, decline it or see it
    const other = await signUp(baseUrl);
    expect((await other.send("POST", `/api/invitations/${list[0].id}/accept`, {})).status).toBe(404);
    expect((await other.send("POST", `/api/invitations/${list[0].id}/decline`, {})).status).toBe(404);
    expect((await other.get("/api/invitations")).data.invitations).toEqual([]);

    const ownerStream = watchEvents(baseUrl, owner, trip.id);
    await ownerStream.ready;
    const accepted = await guest.send("POST", `/api/invitations/${list[0].id}/accept`, {});
    expect(accepted).toMatchObject({ status: 200, data: { tripId: trip.id } });
    const snap = await ownerStream.next((e) => e.event === "snapshot" && e.data.members.some((m: any) => m.id === guest.userId));
    expect(snap.data.rev).toBeGreaterThan(trip.rev);
    expect((await guest.get("/api/trips")).data.shared.map((t: any) => t.id)).toContain(trip.id);
    expect((await guest.get("/api/invitations")).data.invitations).toEqual([]);
    expect((await owner.get(`/api/trips/${trip.id}/invitations`)).data.invitations[0].status).toBe("accepted");
    own.close();
    ownerStream.close();
  });

  it("refuses self-invites, members, duplicates (even all at once) and anyone but the owner", async () => {
    const { owner, guest, trip } = await setup();
    expect((await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: owner.userId })).status).toBe(400);
    expect((await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    const burst = await Promise.all(Array.from({ length: 6 }, () => owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: guest.userId })));
    expect(burst.filter((r) => r.status === 201)).toHaveLength(1);
    expect(burst.filter((r) => r.status === 409).every((r) => r.data.code === "invited")).toBe(true);
    expect((await guest.get("/api/invitations")).data.invitations).toHaveLength(1);

    const collab = await signUp(baseUrl);
    await share(owner, collab, trip.id);
    expect((await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: collab.userId })).data.code).toBe("member");
    const third = await signUp(baseUrl);
    expect((await collab.send("POST", `/api/trips/${trip.id}/invitations`, { userId: third.userId })).status).toBe(403);
    expect((await third.send("POST", `/api/trips/${trip.id}/invitations`, { userId: collab.userId })).status).toBe(404);
    // a client can't name the sender: the session decides who invited
    await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: third.userId, inviterId: collab.userId });
    expect((await third.get("/api/invitations")).data.invitations[0].inviter.id).toBe(owner.userId);
  });

  it("is safe to accept twice or concurrently, and declining or cancelling adds nobody", async () => {
    const { owner, guest, trip } = await setup();
    await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: guest.userId });
    const [inv] = (await guest.get("/api/invitations")).data.invitations;
    const results = await Promise.all(Array.from({ length: 5 }, () => guest.send("POST", `/api/invitations/${inv.id}/accept`, {})));
    expect(results.every((r) => r.status === 200 && r.data.tripId === trip.id)).toBe(true);
    const members = (await owner.get(`/api/trips/${trip.id}`)).data.members;
    expect(members.filter((m: any) => m.id === guest.userId)).toHaveLength(1);

    const d = await signUp(baseUrl);
    await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: d.userId });
    const [dInv] = (await d.get("/api/invitations")).data.invitations;
    expect((await d.send("POST", `/api/invitations/${dInv.id}/decline`, {})).status).toBe(200);
    expect((await d.send("POST", `/api/invitations/${dInv.id}/accept`, {})).status).toBe(409);
    expect((await d.get(`/api/trips/${trip.id}`)).status).toBe(404);

    const c = await signUp(baseUrl);
    const sent = await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: c.userId });
    expect((await guest.send("DELETE", `/api/trips/${trip.id}/invitations/${sent.data.invitation.id}`)).status).toBe(403); // collaborators can't cancel
    expect((await owner.send("DELETE", `/api/trips/${trip.id}/invitations/${sent.data.invitation.id}`)).status).toBe(200);
    expect((await c.get("/api/invitations")).data.invitations).toEqual([]);
    expect((await c.send("POST", `/api/invitations/${sent.data.invitation.id}/accept`, {})).status).toBe(409);
    expect((await c.get(`/api/trips/${trip.id}`)).status).toBe(404);
    // after a decline or a cancel the owner can invite again
    expect((await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: c.userId })).status).toBe(201);
  });

  it("never lets a removed collaborator back in through the invitation they already used", async () => {
    const { owner, guest, trip } = await setup();
    await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: guest.userId });
    const [inv] = (await guest.get("/api/invitations")).data.invitations;
    await guest.send("POST", `/api/invitations/${inv.id}/accept`, {});
    expect((await owner.send("DELETE", `/api/trips/${trip.id}/members/${guest.userId}`)).status).toBe(200);
    expect((await guest.send("POST", `/api/invitations/${inv.id}/accept`, {})).status).toBe(409);
    expect((await guest.get(`/api/trips/${trip.id}`)).status).toBe(404);
  });

  it("keeps the two ways of inviting independent", async () => {
    const { owner, guest, trip } = await setup();
    const sent = await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: guest.userId });
    const linkUser = await signUp(baseUrl);
    const token = (await owner.send("POST", `/api/trips/${trip.id}/invite`, {})).data.token;
    // turning the link off leaves the named invitation pending
    await owner.send("DELETE", `/api/trips/${trip.id}/invite`);
    expect((await guest.get("/api/invitations")).data.invitations.map((i: any) => i.id)).toEqual([sent.data.invitation.id]);
    expect((await linkUser.send("POST", `/api/invites/${token}/request`, {})).status).toBe(404);
    // cancelling a named invitation leaves a new link working
    const token2 = (await owner.send("POST", `/api/trips/${trip.id}/invite`, {})).data.token;
    await owner.send("DELETE", `/api/trips/${trip.id}/invitations/${sent.data.invitation.id}`);
    expect((await linkUser.send("POST", `/api/invites/${token2}/request`, {})).status).toBe(201);
  });

  it("keeps a pending invitation through sign-out, and drops it with a deleted trip", async () => {
    const { owner, guest, name, trip } = await setup();
    await owner.send("POST", `/api/trips/${trip.id}/invitations`, { userId: guest.userId });
    await guest.send("POST", "/api/auth/logout", {});
    const back = await logIn(baseUrl, name);
    const list = (await back.get("/api/invitations")).data.invitations;
    expect(list).toHaveLength(1);
    expect((await owner.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(200);
    expect((await back.get("/api/invitations")).data.invitations).toEqual([]);
    expect((await back.send("POST", `/api/invitations/${list[0].id}/accept`, {})).status).toBe(404);
  });
});
