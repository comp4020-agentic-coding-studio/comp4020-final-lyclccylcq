# Google Maps Platform keys

Wayline uses two separate keys. Never give them the same value.

| Variable | Used by | APIs | Exposed? |
|---|---|---|---|
| `GOOGLE_MAPS_BROWSER_KEY` | `public/map.js`, which loads the Maps JS script. The key comes from `GET /api/config` at runtime. | Maps JavaScript API | Yes, to every visitor, by design |
| `GOOGLE_MAPS_SERVER_KEY` | `src/google.ts` only | Places API (New), Routes API, Geocoding API | Never |
| `GOOGLE_MAPS_MAP_ID` (optional) | Advanced Markers | none (map styling id) | Yes, not a secret |

The browser never calls Places, Routes or Geocoding directly. It goes through
`/api/places/*`, `/api/geo/reverse`, `/api/routes` and `/api/trips/:id/routes`,
which are rate-limited per IP.

There is no frontend build step. `public/` is served as-is and the browser key
is read at request time, so changing a key never needs a rebuild, only a
restart.

## Google Cloud console

Enable these in **APIs & Services → Library**: Maps JavaScript API, Places API
(New), Routes API and Geocoding API. Don't enable the legacy "Places API" or
"Directions API".

### Browser key

1. **APIs & Services → Credentials → Create credentials → API key.** Rename it
   to something like `wayline-browser`.
2. **Application restrictions → Websites**, then add:
   - `https://comp4020-final-lyclccylcq.fly.dev/*`
   - `http://localhost:8080/*`
   - any custom domain, if you add one later
3. **API restrictions → Restrict key → Maps JavaScript API** only.
4. Save.

### Server key

1. Create a second API key, e.g. `wayline-server`.
2. **Application restrictions → None.** Don't use a website restriction:
   server requests send no referrer, so Google rejects them, and the app
   reports "has a website restriction".
3. **API restrictions → Restrict key**: Places API (New), Routes API,
   Geocoding API.
4. Save.

**Why no IP restriction.** A Fly Machine's outbound IP isn't stable and can
change without notice, for example when the machine is moved. An IP-restricted
key would then start failing. If you later allocate a static egress IP on Fly
(app-scoped static egress IPs, a paid feature; check Fly's current docs), you
can switch the server key to **IP addresses** with both the IPv4 and IPv6 it
reports. Do that only after confirming that outbound requests actually use
those addresses.

**What's left at risk:** if the server key leaked, anyone could use it from
anywhere for those three APIs until you rotate it. The protections in place:
it's never sent to the browser, logged or committed; the API restrictions;
per-IP rate limits on the public endpoints; and the following, which you set
in the console:

- **Quotas** (APIs & Services → each API → Quotas): set per-day caps on
  Places API (New), Routes API and Geocoding API that fit the expected
  traffic.
- **Budget alert** (Billing → Budgets & alerts) at a small monthly amount.

## Local development

```sh
cp .env.example .env    # gitignored
# fill GOOGLE_MAPS_BROWSER_KEY and GOOGLE_MAPS_SERVER_KEY
pnpm dev                # startup line says set/missing, never the values
pnpm check:google       # live checks against the running app
```

## Fly.io

Keys are Fly **secrets**, which are runtime environment variables. Don't put
them in `fly.toml`, the Dockerfile or build args.

```sh
fly secrets set GOOGLE_MAPS_BROWSER_KEY=... GOOGLE_MAPS_SERVER_KEY=... -a comp4020-final-lyclccylcq
fly secrets list -a comp4020-final-lyclccylcq   # the two digests must differ
```

Setting secrets restarts the machine with the new values, and no redeploy is
needed. Because the keys live on Fly, the deployed app doesn't depend on
anything on your computer.

## Why one key isn't enough

A key has one kind of application restriction. The browser key must be
website-restricted because every visitor can see it. Server requests carry
no referrer, so a website-restricted key fails for Places, Routes and
Geocoding. A single unrestricted key would let anyone who copies it from
`/api/config` spend the server APIs' quota.

## Migrating from one shared key, and rotating

You need only one new key:

1. Keep the existing key as the **browser key**. It's already public, which
   is fine once it's restricted. Add the website restriction and limit it to
   Maps JavaScript API, as above.
2. Create one new **server key** as above.
3. Put it in `.env` as `GOOGLE_MAPS_SERVER_KEY`, then run `pnpm dev` and
   `pnpm check:google`.
4. Run `fly secrets set GOOGLE_MAPS_SERVER_KEY=... -a comp4020-final-lyclccylcq`.
   Then check on the live site that the map renders, place search works, and
   "Get travel times" returns a route.
5. Check `fly logs` for the startup line. The "same key" warning should be gone.

Rotating a single key works the same way: create the new key, set it, verify,
then revoke the old one.

## Common problems

| Symptom | Cause |
|---|---|
| Map shows "This page can't load Google Maps correctly"; console has `RefererNotAllowedMapError` | The browser key's website list lacks this origin (check the port and `https`) |
| Console has `ApiNotActivatedMapError` | Maps JavaScript API not enabled, or not on the browser key |
| Search/routes: "has a website restriction" | The server key has a website restriction. Set it to None |
| "isn't enabled for this Google Cloud project" | That API isn't enabled, or not in the server key's API list |
| "billing isn't enabled" | Link a billing account to the project |
| "usage limits have been reached" | A quota or rate limit was hit. Check the quotas above |
| Startup warning "are the same key" | Both variables hold one key. Split them |
