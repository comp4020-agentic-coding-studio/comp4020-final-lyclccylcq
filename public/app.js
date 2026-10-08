import { openEditor } from "/editor.js";
import { api, ApiError, avatar, fmtRange, h, icon, openDialog, relTime, toast } from "/ui.js";

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
  const join = path.match(/^\/join\/([A-Za-z0-9_-]+)$/);
  const trip = path.match(/^\/trips\/([0-9a-f-]{36})$/);

  if (!state.me) return renderAuth(path === "/login" ? new URLSearchParams(location.search).get("next") : path);
  if (path === "/login") return navigate(new URLSearchParams(location.search).get("next") || "/", { replace: true });
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
  return renderDashboard();
}

function topbar() {
  return h(
    "header",
    { class: "topbar" },
    h("a", { class: "brand", href: "/", "data-link": true }, h("span", { class: "brand-mark", "aria-hidden": "true" }), "Wayline"),
    h(
      "nav",
      { class: "topbar-nav" },
      h("a", { href: "/readme/" }, "About"),
      state.me &&
        h(
          "span",
          { class: "me" },
          avatar({ id: state.me.id, displayName: state.me.displayName }, "sm"),
          h("span", { class: "me-name" }, state.me.displayName),
        ),
      state.me && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: signOut }, "Sign out"),
    ),
  );
}

async function signOut() {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  state.me = null;
  navigate("/login", { replace: true });
}

// --- sign in -----------------------------------------------------------------

function renderAuth(next) {
  if (location.pathname !== "/login") {
    history.replaceState(null, "", `/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  let mode = "signup";
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const nameField = h("label", { class: "field" }, h("span", {}, "Your name"), h("input", { name: "displayName", autocomplete: "nickname", maxlength: 40, placeholder: "How collaborators will see you" }));
  const submit = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Create account");
  const tabs = h("div", { class: "seg", role: "tablist" });
  const form = h(
    "form",
    { class: "auth-form", novalidate: true },
    tabs,
    nameField,
    h("label", { class: "field" }, h("span", {}, "Username"), h("input", { name: "username", autocomplete: "username", required: true, minlength: 3, maxlength: 32 })),
    h("label", { class: "field" }, h("span", {}, "Password"), h("input", { name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 8 })),
    error,
    submit,
  );
  const setMode = (m) => {
    mode = m;
    nameField.hidden = m !== "signup";
    submit.textContent = m === "signup" ? "Create account" : "Sign in";
    form.password.autocomplete = m === "signup" ? "new-password" : "current-password";
    tabs.replaceChildren(
      ...[["signup", "New here"], ["login", "I have an account"]].map(([k, label]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(k === m), class: k === m ? "on" : "", onclick: () => setMode(k) }, label),
      ),
    );
    error.hidden = true;
  };
  setMode("signup");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const body = { username: form.username.value, password: form.password.value };
      if (mode === "signup") body.displayName = form.displayName.value || form.username.value;
      const { user } = await api(`/api/auth/${mode}`, { method: "POST", body });
      state.me = user;
      navigate(next && next !== "/login" ? next : "/", { replace: true });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
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
  app.replaceChildren(topbar(), h("main", { class: "dash" }, h("div", { class: "boot" }, "Loading your trips…")));
  let data;
  try {
    data = await api("/api/trips");
  } catch (err) {
    if (err.status === 401) return signOut();
    return app.querySelector(".dash").replaceChildren(h("p", { class: "form-error" }, err.message));
  }
  const card = (t) =>
    h(
      "a",
      { class: "trip-card", href: `/trips/${t.id}`, "data-link": true, style: `--hue:${hue(t.destination)}` },
      h("div", { class: "trip-card-band" }, h("span", { class: "trip-card-dest" }, t.destination)),
      h(
        "div",
        { class: "trip-card-body" },
        h("h3", {}, t.title),
        h("p", { class: "trip-card-dates" }, fmtRange(t.startDate, t.endDate)),
        h(
          "p",
          { class: "trip-card-meta" },
          h("span", {}, `${t.people} ${t.people === 1 ? "traveller" : "travellers"}`),
          t.role !== "owner" && h("span", {}, `Owner: ${t.ownerName}`),
          h("span", {}, `Updated ${relTime(t.updatedAt)}`),
        ),
      ),
    );
  const section = (title, list, empty) =>
    h("section", { class: "dash-section" }, h("h2", {}, title), list.length ? h("div", { class: "trip-grid" }, list.map(card)) : empty);

  app.querySelector(".dash").replaceChildren(
    h(
      "div",
      { class: "dash-hero" },
      h("div", {}, h("p", { class: "eyebrow" }, "Your trips"), h("h1", {}, `Where to next, ${state.me.displayName}?`)),
      h("button", { class: "btn btn-primary", type: "button", onclick: newTripDialog }, icon("plus"), "New trip"),
    ),
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
    section("Shared with you", data.shared, h("p", { class: "muted" }, "When someone invites you to their trip, it shows up here.")),
  );
}

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function newTripDialog() {
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
    h("label", { class: "field" }, h("span", {}, "Destination"), h("input", { name: "destination", required: true, maxlength: 120, placeholder: "Tokyo, Japan" })),
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
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      btn.disabled = false;
    }
  });
}

// --- joining a shared trip -----------------------------------------------------

async function renderJoin(token) {
  app.replaceChildren(topbar(), h("main", { class: "center-page" }, h("div", { class: "boot" }, "Checking your invite…")));
  const main = app.querySelector("main");
  try {
    const p = await api(`/api/invites/${token}`);
    if (p.alreadyMember) return navigate(`/trips/${p.tripId}`, { replace: true });
    const btn = h("button", { class: "btn btn-primary btn-block", type: "button" }, "Join this trip");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const { tripId } = await api(`/api/invites/${token}/accept`, { method: "POST", body: {} });
        toast(`You joined ${p.title}.`);
        navigate(`/trips/${tripId}`, { replace: true });
      } catch (err) {
        toast(err.message, { kind: "error" });
        btn.disabled = false;
      }
    });
    main.replaceChildren(
      h(
        "div",
        { class: "invite-card", style: `--hue:${hue(p.destination)}` },
        h("p", { class: "eyebrow" }, `${p.ownerName} invited you to plan`),
        h("h1", {}, p.title),
        h("p", { class: "lede" }, `${p.destination} · ${fmtRange(p.startDate, p.endDate)}`),
        h("p", { class: "muted" }, "As a collaborator you can add places, change times and reorder the plan. Everyone on the trip sees changes as they happen."),
        btn,
      ),
    );
  } catch (err) {
    main.replaceChildren(h("div", { class: "invite-card" }, h("h1", {}, "Invite not valid"), h("p", {}, err.message), h("a", { class: "btn btn-ghost", href: "/", "data-link": true }, "Go to your trips")));
  }
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
