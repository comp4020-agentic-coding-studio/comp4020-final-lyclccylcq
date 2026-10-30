import { openEditor } from "/editor.js";
import { renderHome, tripCard } from "/home.js";
import { CREDITS as JOURNEY_CREDITS } from "/journey.js";
import { HERO_CLIPS } from "/media.js";
import { coverImg, PHOTOS, photoFor } from "/photos.js";
import { renderPreview } from "/preview.js";
import { api, ApiError, avatar, fill, fmtRange, h, icon, openDialog, relTime, toast } from "/ui.js";

const app = document.getElementById("app");
const state = { me: null, config: null };
let cleanup = null;

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  route();
}

window.addEventListener("popstate", route);
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});

async function route() {
  cleanup?.();
  cleanup = null;
  const path = location.pathname;
  const next = new URLSearchParams(location.search).get("next");
  const join = path.match(/^\/join\/([A-Za-z0-9_-]+)$/);
  const trip = path.match(/^\/trips\/([0-9a-f-]{36})$/);
  const itinerary = path.match(/^\/itineraries\/([a-z0-9-]{3,80})$/);
  window.scrollTo(0, 0);

  // open to everyone
  if (path === "/") return void (cleanup = renderHome(app, ctx()));
  if (itinerary) return void (cleanup = await renderPreview(app, itinerary[1], ctx()));
  if (path === "/privacy") return renderPrivacy();
  if (path === "/credits") return renderCredits();
  if (path === "/experiments/pixel-train") {
    // experimental, unlinked: loaded only when someone opens this address
    const { renderPixelTrain } = await import("/pixel-train.js");
    return void (cleanup = renderPixelTrain(app, ctx()));
  }
  if (path === "/login") return state.me ? navigate(next || "/", { replace: true }) : renderAuth(next);

  // everything else needs an account
  if (!state.me) return navigate(`/login?next=${encodeURIComponent(path + location.search)}`, { replace: true });
  if (join) return renderJoin(join[1]);
  if (trip) {
    app.replaceChildren(h("div", { class: "boot", role: "status" }, "Opening trip…"));
    try {
      cleanup = await openEditor(app, trip[1], { me: state.me, config: state.config, navigate, signOut });
    } catch (err) {
      renderMissing(err instanceof ApiError && err.status === 404 ? "This trip doesn't exist, or you don't have access to it." : err.message);
    }
    return;
  }
  if (path === "/trips") {
    cleanup = (await renderDashboard()) ?? null;
    if (new URLSearchParams(location.search).get("new") === "1") newTripDialog();
    return;
  }
  renderMissing("There's no page at this address.");
}

const ctx = () => ({ me: state.me, config: state.config, navigate, signOut, topbar, footer, createTrip });

// destination: a place picked on the homepage, filled in (still editable)
function createTrip(destination = "") {
  if (state.me) newTripDialog(typeof destination === "string" ? destination : "");
  else navigate(`/login?next=${encodeURIComponent("/trips?new=1")}`);
}

function topbar(active = "") {
  const tripsLink = h("a", { href: "/trips", "data-link": true, class: active === "trips" ? "on" : "" }, "My Trips");
  // pending invitations, counted once per page; My Trips shows them live
  if (state.me && active !== "trips") {
    api("/api/invitations")
      .then(({ invitations }) => invitations.length && tripsLink.append(" ", h("span", { class: "badge badge-danger", "aria-label": `${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}` }, String(invitations.length))))
      .catch(() => {});
  }
  return h(
    "header",
    { class: "topbar" },
    h("a", { class: "brand", href: "/", "data-link": true }, h("span", { class: "brand-mark", "aria-hidden": "true" }), "Wayline"),
    h(
      "nav",
      { class: "topbar-nav", "aria-label": "Main" },
      h("a", { href: "/#explore-map", "data-link": true, class: active === "home" ? "on" : "" }, "Explore"),
      tripsLink,
      h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: createTrip }, icon("plus"), h("span", { class: "hide-xs" }, "Create Trip")),
      state.me
        ? h(
            "span",
            { class: "me" },
            avatar({ id: state.me.id, displayName: state.me.displayName }, "sm"),
            h("span", { class: "me-name" }, state.me.displayName),
            h("button", { class: "btn btn-ghost btn-sm signout", type: "button", "aria-label": "Sign out", onclick: signOut }, icon("signout"), h("span", { class: "hide-xs" }, "Sign out")),
          )
        : h("a", { class: "btn btn-ghost btn-sm", href: `/login?next=${encodeURIComponent(location.pathname)}`, "data-link": true }, "Sign in"),
    ),
  );
}

function footer() {
  return h(
    "footer",
    { class: "site-footer" },
    h("div", {}, h("strong", {}, "Wayline"), h("span", { class: "muted" }, " · plan trips together")),
    h(
      "nav",
      { "aria-label": "Legal and about" },
      h("a", { href: "/readme/" }, "About"),
      h("a", { href: "/privacy", "data-link": true }, "Privacy"),
      h("a", { href: "/credits", "data-link": true }, "Photo & video credits"),
      h("a", { href: "https://maps.google.com/help/terms_maps/", target: "_blank", rel: "noopener" }, "Google Maps Terms"),
      h("a", { href: "https://policies.google.com/privacy", target: "_blank", rel: "noopener" }, "Google Privacy Policy"),
    ),
    h("p", { class: "muted small" }, "Maps, places and routes come from Google Maps Platform when it's configured. Sample itineraries are curated by Wayline."),
  );
}

function renderPrivacy() {
  const ext = (href, label) => h("a", { href, target: "_blank", rel: "noopener" }, label);
  app.replaceChildren(
    topbar(),
    h(
      "main",
      { class: "readme" },
      h("h1", {}, "Privacy"),
      h("p", { class: "callout" }, "Draft for the V1 prototype; to be reviewed by the project author before public use."),
      h("h2", {}, "What Wayline stores"),
      h("p", {}, "Your account (username, display name and a hashed password), the trips you create or join, and what you add to them. Everyone on a trip can see that trip."),
      h("h2", {}, "Finding people and invitations"),
      h(
        "p",
        {},
        "Your login username and nickname (entered as “Your name” at registration) are each unique. Someone planning a trip can find you by your nickname. Only a trip's owner can search, and only while inviting people to that trip; a search shows the matching usernames and display names and nothing else about your account. When an owner invites you, Wayline stores who invited you to which trip and whether you accepted, declined, or the owner cancelled it. You see the trip's title, destination and dates before deciding, and you join only if you accept.",
      ),
      h("h2", {}, "Invite links, publishing and reviews"),
      h(
        "p",
        {},
        "When you ask to join a trip through an invite link, Wayline stores your request (your account, the trip, when, and whether the owner approved or rejected it); the owner sees your username and display name. If you publish a trip, anyone can see its title, description, destination, stops, times and places, and your display name as its author. Your notes, the people on the trip and invite links are never published, and unpublishing hides it again. Reviews you write show your display name, rating and comment to everyone who views that trip, until you delete them.",
      ),
      h("h2", {}, "Travel preferences and AI"),
      h(
        "p",
        {},
        "If you set travel preferences, Wayline stores them with your account. Your food choices, dietary needs and allergies are private to you; a trip's shared choices (transport, pace, budget, interests) are visible to everyone on that trip. When you use the copilot or Plan with AI, the selected day's stops and notes, your preferences and nearby Google places are sent to the AI provider (OpenAI). Your allergy text is never sent, only that you have allergies. Wayline records that a request was made, by whom, and how many tokens it used, but not the request or the answer.",
      ),
      h("h2", {}, "Your location"),
      h(
        "p",
        {},
        "On your first visit the homepage offers to use your location; your browser only asks for permission after you press “Use my location”, and “Not now” is remembered. The coordinates go to Wayline's server with each request to find nearby itineraries and places and the name of your area, and are not stored or logged there. Your browser keeps a rounded copy (about 1 km) on this device, with any destination you picked, so the homepage remembers them next time. If you said yes and your browser still allows it, Wayline refreshes that copy at most once per visit; it never tracks you continuously. “Forget” on the homepage removes it, and so does clearing this site's data.",
      ),
      h("h2", {}, "Where your map is looking"),
      h(
        "p",
        {},
        "While someone else has the same trip open, the people on that trip can see roughly where your trip map is looking (its centre and zoom), shown as your initials on their map. This is the map view only, never your device's location. It goes only to people on that trip, isn't stored, and disappears when you close the trip or stop moving the map for a minute.",
      ),
      h("h2", {}, "The AI copilot"),
      h(
        "p",
        {},
        "Only when you press “Review this day” or ask a question, Wayline sends that one day of the trip to its AI provider (OpenAI): the trip's destination and that day's date, each stop's title, type, times and notes, the travel times and transit lines Google returned between stops, and the schedule problems and fixes Wayline calculated. Your question and up to four of your earlier questions and answers about the same day go with it. Your name, account, other days, the trip's title and members, your location and your map view are not sent. Nothing is sent when the map moves, the plan updates or the page opens. Answers are kept in the server's memory for a while so the same question about the same plan isn't asked twice, and your conversation stays in your browser tab only; Wayline doesn't save it. Notes you write are shared with the AI provider when you ask, so don't put anything in a note you wouldn't want sent.",
      ),
      h("h2", {}, "Voice calls"),
      h(
        "p",
        {},
        "You can make an audio-only call to someone else on the same trip. Your browser asks for the microphone only when you press Call or Accept. The audio goes directly between the two browsers, or through a relay server when a direct connection isn't possible; it is encrypted by the browser (WebRTC), and it never passes through Wayline's server, is never recorded or transcribed, and is never sent to the AI. To connect the call, Wayline's server passes short technical messages between the two browsers (connection details including network addresses); these are kept in memory only while the call is being set up or is running, and are never saved. If a relay is used, your network address and the encrypted audio pass through the relay provider (Cloudflare) while the call lasts.",
      ),
      h("h2", {}, "Google Maps Platform"),
      h(
        "p",
        {},
        "Searches, place details, maps and routes are provided by Google Maps Platform, so those requests are processed by Google under the ",
        ext("https://maps.google.com/help/terms_maps/", "Google Maps Terms of Service"),
        " and the ",
        ext("https://policies.google.com/privacy", "Google Privacy Policy"),
        ". Wayline keeps Google place IDs, not copies of Google's place content.",
      ),
    ),
    footer(),
  );
}

function renderCredits() {
  const ext = (href, label, rel = "noopener") => h("a", { href, target: "_blank", rel }, label);
  app.replaceChildren(
    topbar(),
    h(
      "main",
      { class: "readme" },
      h("h1", {}, "Photo and video credits"),
      h("p", {}, "The destination photos, journey scenery and video clips on Wayline come from Wikimedia Commons. Photos are resized, cropped and gently colour-graded; clips are shortened and silent. Each is used under the license named below. Place photos inside place details come from Google Maps and are credited where they appear."),
      h("h2", {}, "Journey window"),
      h("ul", { class: "credits-list" }, JOURNEY_CREDITS.map((c) =>
        h("li", {}, h("strong", {}, c.title), " · ", ext(c.page, c.author), " · ", ext(c.licenseUrl, c.license, "noopener license")),
      )),
      h("h2", {}, "Videos"),
      h(
        "ul",
        { class: "credits-list" },
        HERO_CLIPS.map((c) =>
          h("li", {}, h("strong", {}, `${c.city}, ${c.country}`), " · ", ext(c.page, c.author ?? "Wikimedia Commons"), " · ", ext(c.licenseUrl, c.license, "noopener license")),
        ),
      ),
      h("h2", {}, "Photos"),
      h(
        "ul",
        { class: "credits-list" },
        Object.values(PHOTOS).map((p) =>
          h("li", {}, h("strong", {}, p.alt), " · ", ext(p.page, p.author ?? "Wikimedia Commons"), " · ", ext(p.licenseUrl, p.license, "noopener license")),
        ),
      ),
    ),
    footer(),
  );
}

async function signOut() {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  state.me = null;
  navigate("/", { replace: true });
}

// --- sign in -----------------------------------------------------------------

function renderAuth(next) {
  let mode = "signup";
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  // one message slot per field, tied to its input for screen readers
  const field = (name, label, attrs, hint) => {
    const msg = h("small", { class: "field-msg", id: `msg-${name}`, "aria-live": "polite" }, hint ?? "");
    const input = h("input", { name, "aria-describedby": `msg-${name}`, ...attrs });
    return { el: h("label", { class: "field" }, h("span", {}, label), input, msg), input, msg, hint: hint ?? "" };
  };
  const display = field("displayName", "Your name", { autocomplete: "nickname", maxlength: 40, placeholder: "How collaborators will see you" }, "Shown to people on your trips. Must be unique.");
  const user = field("username", "Username", { autocomplete: "username", required: true, minlength: 3, maxlength: 32, spellcheck: "false", autocapitalize: "none" });
  const pass = field("password", "Password", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
  const fields = { displayName: display, username: user, password: pass };
  const setMsg = (f, text, bad) => {
    f.msg.textContent = text ?? f.hint;
    f.msg.classList.toggle("is-error", Boolean(bad));
    f.msg.classList.toggle("is-ok", bad === false);
    if (bad) f.input.setAttribute("aria-invalid", "true");
    else f.input.removeAttribute("aria-invalid");
  };
  const clearMsgs = () => Object.values(fields).forEach((f) => setMsg(f, null));
  const submit = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Create account");
  const tabs = h("div", { class: "seg", role: "tablist" });
  const form = h("form", { class: "auth-form", novalidate: true }, tabs, display.el, user.el, pass.el, error, submit);

  // An early hint while typing (debounced); the account is only safe once
  // the server accepts it, and its answer replaces any hint.
  let checkTimer = null;
  let checkSeq = 0;
  const check = (name) => {
    if (mode !== "signup") return;
    clearTimeout(checkTimer);
    const f = fields[name];
    const value = f.input.value.trim();
    if (!value || (name === "username" && value.length < 3)) return setMsg(f, null);
    checkTimer = setTimeout(async () => {
      const seq = ++checkSeq;
      try {
        const r = await api(`/api/auth/available?${new URLSearchParams({ [name]: value })}`);
        if (seq !== checkSeq || f.input.value.trim() !== value) return; // a newer check or edit won
        if (r[name] === false) setMsg(f, name === "username" ? "That username is already taken." : "That display name is already taken.", true);
        else setMsg(f, name === "username" ? "Available." : "Available.", false);
      } catch {
        if (seq === checkSeq) setMsg(f, null);
      }
    }, 350);
  };
  display.input.addEventListener("input", () => check("displayName"));
  user.input.addEventListener("input", () => check("username"));

  const setMode = (m) => {
    mode = m;
    display.el.hidden = m !== "signup";
    submit.textContent = m === "signup" ? "Create account" : "Sign in";
    pass.input.autocomplete = m === "signup" ? "new-password" : "current-password";
    tabs.replaceChildren(
      ...[["signup", "New here"], ["login", "I have an account"]].map(([k, label]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(k === m), class: k === m ? "on" : "", onclick: () => setMode(k) }, label),
      ),
    );
    error.hidden = true;
    clearMsgs();
  };
  setMode("signup");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    clearTimeout(checkTimer);
    checkSeq++;
    clearMsgs();
    submit.disabled = true;
    try {
      const body = { username: user.input.value, password: pass.input.value };
      if (mode === "signup") body.displayName = display.input.value.trim() || user.input.value;
      const { user: me } = await api(`/api/auth/${mode}`, { method: "POST", body });
      state.me = me;
      navigate(next && next !== "/login" ? next : "/", { replace: true });
    } catch (err) {
      // the field that needs fixing says so, and keeps what was typed
      const f = mode === "signup" && fields[err.data?.field];
      if (f) {
        setMsg(f, err.message, true);
        f.input.focus();
      } else {
        error.textContent = err.message;
        error.hidden = false;
      }
    } finally {
      submit.disabled = false;
    }
  });

  app.replaceChildren(
    h(
      "div",
      { class: "auth" },
      h(
        "section",
        { class: "auth-hero" },
        h("a", { class: "brand brand-lg", href: "/readme/" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), "Wayline"),
        h("h1", {}, "You choose where to go.", h("br"), h("em", {}, "Wayline helps you get there.")),
        h(
          "p",
          { class: "lede" },
          "Plan a trip together on one map and one timeline. Pick the places you want to visit, and Wayline works out the travel time between them and flags a plan that doesn't add up.",
        ),
        heroArt(),
        next?.startsWith("/join/") && h("p", { class: "callout" }, "You've been invited to a trip. Sign in or create an account to join it."),
      ),
      h("section", { class: "auth-card" }, h("h2", {}, "Start planning"), form),
    ),
  );
}

function heroArt() {
  const stops = [
    ["09:00", "Harbour walk"],
    ["11:30", "Gallery"],
    ["13:00", "Lunch by the water"],
  ];
  return h(
    "div",
    { class: "hero-art", "aria-hidden": "true" },
    h(
      "ol",
      {},
      stops.map(([t, label], i) => [
        h("li", { class: "hero-stop" }, h("b", {}, String(i + 1)), h("span", { class: "t" }, t), h("span", {}, label)),
        i < stops.length - 1 && h("li", { class: "hero-leg" }, i === 0 ? "18 min by ferry" : "12 min walk"),
      ]),
    ),
  );
}

// --- dashboard ---------------------------------------------------------------

async function renderDashboard() {
  app.replaceChildren(topbar("trips"), h("main", { class: "dash" }, h("div", { class: "boot" }, "Loading your trips…")));
  let data;
  let invites;
  try {
    [data, invites] = await Promise.all([api("/api/trips"), api("/api/invitations")]);
  } catch (err) {
    if (err.status === 401) return signOut();
    return app.querySelector(".dash").replaceChildren(h("p", { class: "form-error" }, err.message));
  }
  const card = (t) => tripCard(t);
  const section = (title, list, empty) =>
    h("section", { class: "dash-section" }, h("h2", {}, title), list.length ? h("div", { class: "trip-grid" }, list.map(card)) : empty);

  // Invitations addressed to this account. They stay until answered, and a
  // new one appears while this page is open (the account's own stream says
  // the list changed; the list itself comes with this session).
  const invitesBox = h("section", { class: "dash-section invites", "aria-label": "Invitations", hidden: true });
  const requestsBox = h("section", { class: "dash-section invites", "aria-label": "Requests to join your trips", "data-dash": "requests", hidden: true });
  const myRequestsBox = h("section", { class: "dash-section", "aria-label": "Your requests to join", "data-dash": "my-requests", hidden: true });
  const renderInvites = () => {
    invitesBox.hidden = invites.invitations.length === 0;
    fill(
      invitesBox,
      h("h2", {}, "Invitations", h("span", { class: "badge badge-danger" }, String(invites.invitations.length))),
      h("ul", { class: "invite-list" }, invites.invitations.map(inviteRow)),
    );
    const reqs = invites.requests ?? [];
    requestsBox.hidden = reqs.length === 0;
    fill(
      requestsBox,
      h("h2", {}, "Requests to join your trips", h("span", { class: "badge badge-danger" }, String(reqs.length))),
      h("ul", { class: "invite-list" }, reqs.map(requestRow)),
    );
    const mine = invites.myRequests ?? [];
    myRequestsBox.hidden = mine.length === 0;
    const LABEL = { pending: "Waiting for approval", approved: "Approved", rejected: "Not approved" };
    fill(
      myRequestsBox,
      h("h2", {}, "Your requests to join"),
      h(
        "ul",
        { class: "members" },
        mine.map((r) =>
          h(
            "li",
            { "data-my-request": r.status },
            h("span", { class: "grow" }, h("strong", {}, r.trip.title), h("br"), h("small", { class: "muted" }, `${r.trip.destination} · ${r.trip.ownerName}'s trip`)),
            r.trip.id ? h("a", { class: "btn btn-ghost btn-sm", href: `/trips/${r.trip.id}`, "data-link": true }, "Open") : h("span", { class: `chip ${r.status === "rejected" ? "" : "chip-soft"}` }, LABEL[r.status]),
          ),
        ),
      ),
    );
  };
  const requestRow = (rq) => {
    const status = h("span", { class: "small muted", role: "status" });
    const actions = h("div", { class: "row-actions" });
    const decide = async (what) => {
      for (const b of actions.querySelectorAll("button")) b.disabled = true;
      try {
        await api(`/api/trips/${rq.trip.id}/requests/${rq.id}/${what}`, { method: "POST", body: {} });
        actions.replaceChildren();
        status.textContent = what === "approve" ? "Approved." : "Rejected.";
        setTimeout(refresh, 1200);
        if (what === "approve") onTrips();
      } catch (err) {
        status.textContent = err.message;
        setTimeout(refresh, 1500);
      }
    };
    actions.append(
      h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-request-action": "reject", onclick: () => decide("reject") }, "Reject"),
      h("button", { class: "btn btn-primary btn-sm", type: "button", "data-request-action": "approve", onclick: () => decide("approve") }, "Approve"),
    );
    return h(
      "li",
      { class: "invite-row", "data-request": rq.id },
      avatar(rq.user, "md"),
      h("div", { class: "grow" }, h("p", { class: "small muted" }, h("strong", {}, rq.user.displayName), ` @${rq.user.username} asked to join`), h("h3", {}, rq.trip.title), status),
      actions,
    );
  };
  const inviteRow = (inv) => {
    const status = h("span", { class: "small muted", role: "status" });
    const actions = h("div", { class: "row-actions" });
    const act = async (what) => {
      for (const b of actions.querySelectorAll("button")) b.disabled = true;
      try {
        const r = await api(`/api/invitations/${inv.id}/${what}`, { method: "POST", body: {} });
        if (what === "accept") {
          toast(`You joined ${inv.trip.title}.`);
          return navigate(`/trips/${r.tripId}`);
        }
        actions.replaceChildren();
        status.textContent = "Declined.";
        setTimeout(refresh, 1200);
      } catch (err) {
        status.textContent = err.message;
        for (const b of actions.querySelectorAll("button")) b.disabled = false;
        if (err.status === 404 || err.status === 409) setTimeout(refresh, 1500);
      }
    };
    actions.append(
      h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-invite": "decline", onclick: () => act("decline") }, "Decline"),
      h("button", { class: "btn btn-primary btn-sm", type: "button", "data-invite": "accept", onclick: () => act("accept") }, "Accept"),
    );
    return h(
      "li",
      { class: "invite-row", "data-invitation": inv.id, style: `--hue:${hue(inv.trip.destination)}` },
      avatar(inv.inviter, "md"),
      h(
        "div",
        { class: "grow" },
        h("p", { class: "small muted" }, h("strong", {}, inv.inviter.displayName), ` @${inv.inviter.username} invited you to plan`),
        h("h3", {}, inv.trip.title),
        h("p", { class: "small" }, `${inv.trip.destination} · ${fmtRange(inv.trip.startDate, inv.trip.endDate)} · ${inv.trip.people} ${inv.trip.people === 1 ? "traveller" : "travellers"}`),
        status,
      ),
      actions,
    );
  };
  let refreshing = null;
  const refresh = async () => {
    refreshing ??= api("/api/invitations")
      .then((r) => {
        invites = r;
        renderInvites();
      })
      .catch(() => {})
      .finally(() => (refreshing = null));
    return refreshing;
  };
  const events = new EventSource("/api/me/events");
  events.addEventListener("invitations", () => {
    refresh();
    onTrips(); // an approval adds a trip to "Shared with you"
  });
  const onTrips = () => api("/api/trips").then((d) => {
    data = d;
    renderLists();
  }).catch(() => {});
  const lists = h("div", {});
  const renderLists = () =>
    fill(
      lists,
      section(
        "Planned by you",
        data.owned,
        h(
          "div",
          { class: "empty" },
          h("h3", {}, "No trips yet"),
          h("p", {}, "Create a trip, pick your dates, then start adding the places you want to see."),
          h("button", { class: "btn btn-primary", type: "button", onclick: newTripDialog }, "Plan your first trip"),
        ),
      ),
      section("Shared with you", data.shared, h("p", { class: "muted" }, "When someone invites you to their trip and you accept, it shows up here.")),
    );
  events.addEventListener("open", onTrips);

  app.querySelector(".dash").replaceChildren(
    h(
      "div",
      { class: "dash-hero" },
      h("div", {}, h("p", { class: "eyebrow" }, "Your trips"), h("h1", {}, "Where to next?")),
      h("button", { class: "btn btn-primary", type: "button", onclick: newTripDialog }, icon("plus"), "New trip"),
    ),
    requestsBox,
    invitesBox,
    myRequestsBox,
    lists,
  );
  renderInvites();
  renderLists();
  return () => events.close();
}

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function newTripDialog(destination = "") {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const start = new Date(today.getTime() + 14 * 86_400_000);
  const end = new Date(start.getTime() + 2 * 86_400_000);
  const zones = Intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const form = h(
    "form",
    { method: "dialog", class: "stack" },
    h("h2", {}, "New trip"),
    h("label", { class: "field" }, h("span", {}, "Trip name"), h("input", { name: "title", required: true, maxlength: 80, placeholder: "Tokyo Autumn Trip" })),
    h("label", { class: "field" }, h("span", {}, "Destination"), h("input", { name: "destination", required: true, maxlength: 120, placeholder: "Tokyo, Japan", value: destination })),
    h(
      "div",
      { class: "row-2" },
      h("label", { class: "field" }, h("span", {}, "From"), h("input", { name: "startDate", type: "date", required: true, value: iso(start) })),
      h("label", { class: "field" }, h("span", {}, "To"), h("input", { name: "endDate", type: "date", required: true, value: iso(end) })),
    ),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Local time zone at the destination"),
      h("select", { name: "timezone" }, zones.map((z) => h("option", { value: z, selected: z === here }, z.replaceAll("_", " ")))),
      h("small", {}, "Used for transit departure times."),
    ),
    error,
    h(
      "div",
      { class: "dialog-actions" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"),
      h("button", { class: "btn btn-primary", type: "submit", value: "create" }, "Create trip"),
    ),
  );
  const dialog = openDialog(h("dialog", { class: "dialog" }, form));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const trip = await api("/api/trips", {
        method: "POST",
        body: Object.fromEntries(["title", "destination", "startDate", "endDate", "timezone"].map((k) => [k, form[k].value])),
      });
      dialog.close();
      navigate(`/trips/${trip.id}?new=1`); // opens with "Where would you like to start?"
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      btn.disabled = false;
    }
  });
}

// --- joining a shared trip -----------------------------------------------------

// A link lets a signed-in person ask to join; the owner approves. The page
// shows only whose trip it is and where this person stands.
async function renderJoin(token) {
  app.replaceChildren(topbar(), h("main", { class: "center-page" }, h("div", { class: "boot" }, "Checking your invite…")));
  const main = app.querySelector("main");
  let p;
  try {
    p = await api(`/api/invites/${token}`);
  } catch (err) {
    main.replaceChildren(h("div", { class: "invite-card", "data-join": "invalid" }, h("h1", {}, "Invite not valid"), h("p", {}, err.message), h("a", { class: "btn btn-ghost", href: "/", "data-link": true }, "Go to your trips")));
    return;
  }
  if (p.state === "member") return navigate(`/trips/${p.tripId}`, { replace: true });
  const status = h("p", { class: "small", role: "status", "data-join-status": p.state });
  const card = h("div", { class: "invite-card", style: `--hue:${hue(p.destination)}`, "data-join": p.state });
  const show = (state, message) => {
    card.dataset.join = state;
    status.dataset.joinStatus = state;
    status.textContent = message;
  };
  const btn = h("button", { class: "btn btn-primary btn-block", type: "button", "data-join-action": "request" }, "Request to Join");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await api(`/api/invites/${token}/request`, { method: "POST", body: {} });
      btn.remove();
      show("pending", `Request sent. ${p.ownerName} will see it and can approve or reject it. The trip appears in My Trips once you're approved.`);
    } catch (err) {
      btn.disabled = false;
      if (err.status === 410) {
        btn.remove();
        show("expired", "This link has expired. Ask the trip's owner for a new one.");
      } else show(card.dataset.join, err.message);
    }
  });
  const MESSAGES = {
    can_request: "The owner approves each person before they can see or change the trip.",
    pending: `Your request is waiting for ${p.ownerName} to approve it.`,
    expired: "This invite link has expired. Ask the trip's owner for a new one.",
    rejected: "Your last request wasn't approved. You can ask again while this link is valid.",
  };
  show(p.state, MESSAGES[p.state]);
  // h() drops false children; the DOM's own append() would print "false"
  fill(
    card,
    h("p", { class: "eyebrow" }, `${p.ownerName} invited you to plan`),
    h("h1", {}, p.title),
    h("p", { class: "lede" }, p.destination),
    p.state !== "expired" && h("p", { class: "muted small" }, `Link valid until ${new Date(p.expiresAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`),
    h("p", { class: "muted" }, "As a collaborator you can add places to the plan and change the ones you added. Everyone on the trip sees changes as they happen."),
    status,
    (p.state === "can_request" || p.state === "rejected") && btn,
    h("a", { class: "btn btn-ghost", href: "/trips", "data-link": true }, "Go to your trips"),
  );
  main.replaceChildren(card);
}

function renderMissing(message) {
  app.replaceChildren(
    topbar(),
    h("main", { class: "center-page" }, h("div", { class: "invite-card" }, h("h1", {}, "Can't open this trip"), h("p", {}, message), h("a", { class: "btn btn-primary", href: "/", "data-link": true }, "Back to your trips"))),
  );
}

// --- boot --------------------------------------------------------------------

(async () => {
  const [me, config] = await Promise.all([api("/api/auth/me").catch(() => null), api("/api/config").catch(() => null)]);
  state.me = me?.user ?? null;
  state.config = config ?? { places: "demo", routes: false, ai: { configured: false } };
  route();
})();
