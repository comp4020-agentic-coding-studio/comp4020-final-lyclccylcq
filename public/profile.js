import { tripCard } from "/home.js";
import { coverImg, photoFor } from "/photos.js";
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
  app.replaceChildren(ctx.topbar("profile"), h("main", { class: "profile" }, h("div", { class: "boot", role: "status" }, "Loading your profile…")), ctx.footer());
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
  const tabs = h("div", { class: "pf-tabs", role: "tablist", "aria-label": "Your journeys" });
  const list = h("div", { class: "pf-list", role: "tabpanel" });

  function renderAccount() {
    const joined = new Date(profile.createdAt).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    if (S.editing) return fill(account, avatar({ id: profile.id, displayName: profile.displayName }, "lg"), editForm());
    fill(
      account,
      avatar({ id: profile.id, displayName: profile.displayName }, "lg"),
      h(
        "div",
        { class: "pf-who" },
        h("h1", { id: "pf-name", class: "pf-name" }, profile.displayName),
        h("p", { class: "pf-handle" }, `@${profile.username}`, h("span", { "aria-hidden": "true" }, " · "), `Joined ${joined}`),
        profile.bio ? h("p", { class: "pf-bio" }, profile.bio) : h("p", { class: "pf-bio pf-bio-empty" }, "No bio yet."),
        h(
          "div",
          { class: "pf-account-actions" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-profile": "edit", onclick: () => { S.editing = true; renderAccount(); account.querySelector("input")?.focus(); } }, "Edit profile"),
          h("button", { class: "btn btn-quiet btn-sm", type: "button", onclick: signOut }, icon("signout"), "Sign out"),
        ),
      ),
    );
  }

  function editForm() {
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const form = h(
      "form",
      { class: "pf-edit stack" },
      h("label", { class: "field" }, h("span", {}, "Display name"), h("input", { name: "displayName", required: true, maxlength: 40, value: profile.displayName, autocomplete: "nickname" }), h("small", { class: "muted" }, "What others see on trips and published journeys. It must be unique.")),
      h("label", { class: "field" }, h("span", {}, "Bio"), h("textarea", { name: "bio", maxlength: 280, rows: 3, placeholder: "A line about how you like to travel (optional)" }, profile.bio)),
      h("p", { class: "small muted" }, `Username @${profile.username} is how you sign in, and doesn't change.`),
      error,
      h(
        "div",
        { class: "dialog-actions" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.editing = false; renderAccount(); } }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", type: "submit", "data-profile": "save" }, "Save"),
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
        toast("Profile saved.");
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
        h("button", { type: "button", role: "tab", class: `pf-tab${S.tab === k ? " on" : ""}`, "aria-selected": String(S.tab === k), "data-tab": k, onclick: () => { S.tab = k; history.replaceState(null, "", `#${k}`); renderTabs(); renderList(); } }, label, h("span", { class: "pf-count" }, String(count[k]))),
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
          ? h("div", { class: "empty-inline" }, h("p", {}, "No trips yet. Start one, or make a ready-made journey your own."), h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => ctx.createTrip() }, icon("plus"), "New trip"))
          : h("p", { class: "muted" }, "When someone invites you to their trip and you accept, it appears here. Invitations wait on My Trips."),
      );
    }
    fill(
      list,
      h(
        "div",
        { class: "trip-grid" },
        items.map((t) => {
          const card = tripCard(t);
          const p = pubFor(t.id);
          const body = card.querySelector(".trip-card-body");
          body.prepend(h("p", { class: `pf-state ${p ? "is-published" : ""}` }, p ? (p.visibility === "link" ? "Published · link only" : "Published · listed") : S.tab === "created" ? (t.people > 1 ? "Private · shared with your crew" : "Private") : `${t.ownerName}'s trip`));
          return card;
        }),
      ),
    );
  }

  function renderPublished() {
    if (!pubs.length) {
      return fill(list, h("div", { class: "empty-inline" }, h("p", {}, "Nothing published yet. Open one of your trips and choose Publish to share a read-only journey."), trips.owned[0] && h("a", { class: "btn btn-ghost btn-sm", href: `/trips/${trips.owned[0].id}`, "data-link": true }, "Open your latest trip")));
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
        h("p", { class: "pf-state is-published" }, live ? (p.visibility === "link" ? "Link only" : "Listed on Wayline") : "Unpublished"),
        h("h3", {}, h("a", { href: `/journeys/${p.id}`, "data-link": true }, p.title)),
        h("p", { class: "small muted" }, `${p.destination} · published ${relTime(p.publishedAt)}`, live && p.outdated ? " · your trip has changed since" : ""),
        h(
          "div",
          { class: "pf-pub-actions" },
          live && h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-pub-action": "copy", onclick: () => copyLink(p) }, "Copy link"),
          live && p.outdated && h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-pub-action": "update", onclick: () => run(() => publish(p.visibility), "Published version updated to your current plan.") }, "Update to current plan"),
          live && h("button", { class: "btn btn-quiet btn-sm", type: "button", "data-pub-action": "visibility", onclick: () => run(() => publish(p.visibility === "link" ? "listed" : "link"), p.visibility === "link" ? "Listed under Shared by travellers." : "Now link only: no longer listed.") }, p.visibility === "link" ? "List on Wayline" : "Make link only"),
          live
            ? h("button", { class: "btn btn-quiet btn-sm btn-danger-text", type: "button", "data-pub-action": "unpublish", onclick: () => confirmUnpublish(p, () => run(() => api(`/api/trips/${p.tripId}/publication`, { method: "DELETE" }), "Unpublished. The link no longer shows it; your trip is untouched.")) }, "Unpublish")
            : h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-pub-action": "republish", onclick: () => run(() => publish(p.visibility), "Published again.") }, "Publish again"),
          h("a", { class: "btn btn-quiet btn-sm", href: `/trips/${p.tripId}`, "data-link": true }, "Open trip"),
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
    h("main", { class: "profile" }, account, h("section", { class: "pf-journeys", "aria-label": "Your journeys" }, h("h2", { class: "pf-h" }, "Your journeys"), tabs, list)),
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
    toast("Link copied. It opens a read-only journey; it doesn't let anyone edit.");
  } catch {
    prompt("Copy this link:", url);
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
        h("h2", {}, "Unpublish this journey?"),
        h("p", {}, `“${p.title}” stops being readable at its link, and leaves Shared by travellers if it was listed. Your trip itself, its people and copies others already made stay as they are. You can publish it again later.`),
        h(
          "div",
          { class: "dialog-actions" },
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Keep it published"),
          h("button", { class: "btn btn-primary", type: "button", "data-confirm": "unpublish", onclick: () => { dialog.close(); go(); } }, "Unpublish"),
        ),
      ),
    ),
  );
}
