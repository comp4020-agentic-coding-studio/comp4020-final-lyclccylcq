import { tripCard } from "/home.js";
import { coverImg, photoFor } from "/photos.js";
import { locale, t } from "/i18n.js";
import { api, avatar, fill, h, icon, openDialog, relTime, toast } from "/ui.js";

// The signed-in person's own page (/profile): their account as it's stored
// (display name, username, bio, when they joined: no email, since accounts
// have none), and their journeys in one place: trips they made, trips shared
// with them, and the ones they published, with the ways to manage those.
// Everything is their own, read through /api/me/*; nothing here is public.

const TABS = [
  ["created", "Created by me"],
  ["shared", "Shared with me"],
  ["published", "Published"],
];

export async function renderProfile(app, ctx) {
  const { navigate, signOut, refreshMe } = ctx;
  app.replaceChildren(ctx.topbar("profile"), h("main", { class: "profile" }, h("div", { class: "boot", role: "status" }, t("Loading your profile…"))), ctx.footer());
  let profile, trips, pubs;
  try {
    [{ profile }, trips, { publications: pubs }] = await Promise.all([api("/api/me/profile"), api("/api/trips"), api("/api/me/publications")]);
  } catch (err) {
    if (err.status === 401) return signOut();
    app.querySelector("main").replaceChildren(h("p", { class: "form-error pad" }, err.message));
    return () => {};
  }
  const hashTab = location.hash.slice(1);
  const S = { tab: TABS.some(([k]) => k === hashTab) ? hashTab : "created", editing: false };

  const account = h("section", { class: "pf-account", "aria-labelledby": "pf-name" });
  const tabs = h("div", { class: "pf-tabs", role: "tablist", "aria-label": t("Your journeys") });
  const list = h("div", { class: "pf-list", role: "tabpanel" });

  function renderAccount() {
    const joined = new Date(profile.createdAt).toLocaleDateString(locale(), { month: "long", year: "numeric" });
    if (S.editing) return fill(account, avatar({ id: profile.id, displayName: profile.displayName }, "lg"), editForm());
    fill(
      account,
      avatar({ id: profile.id, displayName: profile.displayName }, "lg"),
      h(
        "div",
        { class: "pf-who" },
        h("h1", { id: "pf-name", class: "pf-name" }, profile.displayName),
        h("p", { class: "pf-handle" }, `@${profile.username}`, h("span", { "aria-hidden": "true" }, " · "), t("Joined {date}", { date: joined })),
        profile.bio ? h("p", { class: "pf-bio" }, profile.bio) : h("p", { class: "pf-bio pf-bio-empty" }, t("No bio yet.")),
        h(
          "div",
          { class: "pf-account-actions" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-profile": "edit", onclick: () => { S.editing = true; renderAccount(); account.querySelector("input")?.focus(); } }, t("Edit profile")),
          h("button", { class: "btn btn-quiet btn-sm", type: "button", onclick: signOut }, icon("signout"), t("Sign out")),
        ),
      ),
    );
  }

  function editForm() {
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const form = h(
      "form",
      { class: "pf-edit stack" },
      h("label", { class: "field" }, h("span", {}, t("Display name")), h("input", { name: "displayName", required: true, maxlength: 40, value: profile.displayName, autocomplete: "nickname" }), h("small", { class: "muted" }, t("What others see on trips and published journeys. It must be unique."))),
      h("label", { class: "field" }, h("span", {}, t("Bio")), h("textarea", { name: "bio", maxlength: 280, rows: 3, placeholder: t("A line about how you like to travel (optional)") }, profile.bio)),
      h("p", { class: "small muted" }, t("Username @{username} is how you sign in, and doesn't change.", { username: profile.username })),
      error,
      h(
        "div",
        { class: "dialog-actions" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.editing = false; renderAccount(); } }, t("Cancel")),
        h("button", { class: "btn btn-primary btn-sm", type: "submit", "data-profile": "save" }, t("Save")),
      ),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/me/profile", { method: "PATCH", body: { displayName: form.displayName.value, bio: form.bio.value } });
        profile = r.profile;
        S.editing = false;
        renderAccount();
        await refreshMe(); // the bar's name and avatar follow
        toast(t("Profile saved."));
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
    return h("div", { class: "pf-who" }, form);
  }

  function renderTabs() {
    const count = { created: trips.owned.length, shared: trips.shared.length, published: pubs.filter((p) => p.status === "published").length };
    tabs.replaceChildren(
      ...TABS.map(([k, label]) =>
        h("button", { type: "button", role: "tab", class: `pf-tab${S.tab === k ? " on" : ""}`, "aria-selected": String(S.tab === k), "data-tab": k, onclick: () => { S.tab = k; history.replaceState(null, "", `#${k}`); renderTabs(); renderList(); } }, t(label), h("span", { class: "pf-count" }, String(count[k]))),
      ),
    );
  }

  // published status on the trips you made, from your publications
  const pubFor = (tripId) => pubs.find((p) => p.tripId === tripId && p.status === "published");

  function renderList() {
    if (S.tab === "published") return renderPublished();
    const items = S.tab === "created" ? trips.owned : trips.shared;
    if (!items.length) {
      return fill(
        list,
        S.tab === "created"
          ? h("div", { class: "empty-inline" }, h("p", {}, t("No trips yet. Start one, or make a ready-made journey your own.")), h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => ctx.createTrip() }, icon("plus"), t("New trip")))
          : h("p", { class: "muted" }, t("When someone invites you to their trip and you accept, it appears here. Invitations wait on My Trips.")),
      );
    }
    fill(
      list,
      h(
        "div",
        { class: "trip-grid" },
        items.map((trip) => {
          const card = tripCard(trip);
          const p = pubFor(trip.id);
          const body = card.querySelector(".trip-card-body");
          body.prepend(h("p", { class: `pf-state ${p ? "is-published" : ""}` }, p ? (p.visibility === "link" ? t("Published · link only") : t("Published · listed")) : S.tab === "created" ? (trip.people > 1 ? t("Private · shared with your crew") : t("Private")) : t("{owner}'s trip", { owner: trip.ownerName })));
          // the card is a link to the editor; the printable copy sits beside it
          return h("div", { class: "pf-trip" }, card, h("a", { class: "linklike small pf-export", href: `/trips/${trip.id}/print`, "data-link": true, "data-export": "print" }, t("Export / print")));
        }),
      ),
    );
  }

  function renderPublished() {
    if (!pubs.length) {
      return fill(list, h("div", { class: "empty-inline" }, h("p", {}, t("Nothing published yet. Open one of your trips and choose Publish to share a read-only journey.")), trips.owned[0] && h("a", { class: "btn btn-ghost btn-sm", href: `/trips/${trips.owned[0].id}`, "data-link": true }, t("Open your latest trip"))));
    }
    fill(list, h("ul", { class: "pf-pubs" }, pubs.map(pubRow)));
  }

  function pubRow(p) {
    const live = p.status === "published";
    const photo = photoFor(p.cover);
    const status = h("span", { class: "small muted", role: "status" });
    const busy = (on) => row.querySelectorAll("button").forEach((b) => (b.disabled = on));
    const run = async (fn, done) => {
      busy(true);
      try {
        await fn();
        await reload();
        toast(done);
      } catch (err) {
        status.textContent = err.message;
        busy(false);
      }
    };
    const publish = (visibility) => api(`/api/trips/${p.tripId}/publication`, { method: "PUT", body: { description: p.description, visibility } });
    const row = h(
      "li",
      { class: `pf-pub${live ? "" : " is-off"}`, "data-pub": p.id },
      h("a", { class: `pf-pub-cover${photo ? " has-photo" : ""}`, href: `/journeys/${p.id}`, "data-link": true, tabindex: -1, "aria-hidden": "true" }, coverImg(photo, { decorative: true })),
      h(
        "div",
        { class: "pf-pub-body" },
        h("p", { class: "pf-state is-published" }, live ? (p.visibility === "link" ? t("Link only") : t("Listed on Wayline")) : t("Unpublished")),
        h("h3", {}, h("a", { href: `/journeys/${p.id}`, "data-link": true }, p.title)),
        h("p", { class: "small muted" }, t("{destination} · published {when}", { destination: p.destination, when: relTime(p.publishedAt) }), live && p.outdated ? t(" · your trip has changed since") : ""),
        h(
          "div",
          { class: "pf-pub-actions" },
          live && h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-pub-action": "copy", onclick: () => copyLink(p) }, t("Copy link")),
          h("a", { class: "btn btn-quiet btn-sm", href: `/trips/${p.tripId}/print`, "data-link": true }, t("Export")),
          live && p.outdated && h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-pub-action": "update", onclick: () => run(() => publish(p.visibility), t("Published version updated to your current plan.")) }, t("Update to current plan")),
          live && h("button", { class: "btn btn-quiet btn-sm", type: "button", "data-pub-action": "visibility", onclick: () => run(() => publish(p.visibility === "link" ? "listed" : "link"), p.visibility === "link" ? t("Listed under Shared by travellers.") : t("Now link only: no longer listed.")) }, p.visibility === "link" ? t("List on Wayline") : t("Make link only")),
          live
            ? h("button", { class: "btn btn-quiet btn-sm btn-danger-text", type: "button", "data-pub-action": "unpublish", onclick: () => confirmUnpublish(p, () => run(() => api(`/api/trips/${p.tripId}/publication`, { method: "DELETE" }), t("Unpublished. The link no longer shows it; your trip is untouched."))) }, t("Unpublish"))
            : h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-pub-action": "republish", onclick: () => run(() => publish(p.visibility), t("Published again.")) }, t("Publish again")),
          h("a", { class: "btn btn-quiet btn-sm", href: `/trips/${p.tripId}`, "data-link": true }, t("Open trip")),
        ),
        status,
      ),
    );
    return row;
  }

  async function reload() {
    [trips, { publications: pubs }] = await Promise.all([api("/api/trips"), api("/api/me/publications")]);
    renderTabs();
    renderList();
  }

  app.replaceChildren(
    ctx.topbar("profile"),
    h("main", { class: "profile" }, account, h("section", { class: "pf-journeys", "aria-label": t("Your journeys") }, h("h2", { class: "pf-h" }, t("Your journeys")), tabs, list)),
    ctx.footer(),
  );
  renderAccount();
  renderTabs();
  renderList();
  return () => {};
}

async function copyLink(p) {
  const url = `${location.origin}/journeys/${p.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(t("Link copied. It opens a read-only journey; it doesn't let anyone edit."));
  } catch {
    prompt(t("Copy this link:"), url);
  }
}

function confirmUnpublish(p, go) {
  const dialog = openDialog(
    h(
      "dialog",
      { class: "dialog" },
      h(
        "form",
        { method: "dialog", class: "stack" },
        h("h2", {}, t("Unpublish this journey?")),
        h("p", {}, t("“{title}” stops being readable at its link, and leaves Shared by travellers if it was listed. Your trip itself, its people and copies others already made stay as they are. You can publish it again later.", { title: p.title })),
        h(
          "div",
          { class: "dialog-actions" },
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, t("Keep it published")),
          h("button", { class: "btn btn-primary", type: "button", "data-confirm": "unpublish", onclick: () => { dialog.close(); go(); } }, t("Unpublish")),
        ),
      ),
    ),
  );
}
