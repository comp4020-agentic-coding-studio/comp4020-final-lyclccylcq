import { api, avatar, h, openDialog, toast } from "/ui.js";

// The trip's sharing dialogs, opened from the editor's trip bar: the people
// on the trip and how the owner invites more (a link that needs approval, or
// a nickname search), and publishing a read-only snapshot. They read the
// editor's live state (S.trip, S.presence) as they render; every change goes
// through the API, and the trip's stream brings the result back.

export function shareDialog({ S, me, base, act, events, navigate, isOwner: owner }) {
  const isOwner = owner();
  const linkBox = h("div", { class: "stack" });
  const expiry = (link) => {
    const left = link.expiresAt - Date.now();
    if (left <= 0) return "Expired. Create a new link to invite more people.";
    const mins = Math.max(1, Math.ceil(left / 60_000));
    const h_ = Math.floor(mins / 60);
    const m = mins % 60;
    const when = new Date(link.expiresAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `Expires ${when} (in ${h_ ? `${h_} h` : ""}${h_ && m ? " " : ""}${m || !h_ ? `${m} min` : ""}).`;
  };
  // token: shown once, right after it's made; link: its times, from the server
  const renderLink = (token, link) => {
    linkBox.replaceChildren();
    if (!isOwner) return;
    linkBox.append(h("p", { class: "small", "data-share": "approval-note" }, "Links last 24 hours. Opening one doesn't let anyone in: each person asks to join, and you approve or reject them below."));
    if (token) {
      const url = `${location.origin}/join/${token}`;
      const input = h("input", { readonly: true, value: url, "aria-label": "Invite link", onfocus: (e) => e.target.select() });
      linkBox.append(
        h("div", { class: "copy-row" }, input, h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: async () => { await navigator.clipboard?.writeText(url).catch(() => {}); input.select(); toast("Invite link copied."); } }, "Copy")),
        h("p", { class: "small muted" }, "Shown only now. A new link replaces this one."),
      );
    } else if (link && !link.expired) {
      linkBox.append(h("p", { class: "small muted" }, "An invite link is active. For safety it can't be shown again; create a new one if you need it."));
    } else if (link?.expired) {
      linkBox.append(h("p", { class: "small leg-warn", "data-share": "expired" }, "The last invite link has expired."));
    }
    if (link) linkBox.append(h("p", { class: `small ${link.expired ? "leg-warn" : "muted"}`, "data-share": "expiry" }, expiry(link)));
    const live = link && !link.expired;
    linkBox.append(
      h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-outline btn-sm", type: "button", "data-share": "new-link", onclick: async () => { const r = await act(api(`${base}/invite`, { method: "POST", body: {} })); renderLink(r.token, r.link); } }, link ? "Create a new link" : "Create invite link"),
        (live || token) && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => { await act(api(`${base}/invite`, { method: "DELETE" })); toast("Invite link turned off."); renderLink(null, null); } }, "Turn off link"),
      ),
    );
  };
  const loadLink = () => isOwner && api(`${base}/invite`).then((r) => renderLink(null, r.link)).catch(() => {});

  // requests to join through a link
  const requests = h("ul", { class: "invitations", "data-share": "requests" });
  const REQ_LABEL = { pending: "Waiting", approved: "Approved", rejected: "Rejected" };
  const renderRequests = (list) =>
    requests.replaceChildren(
      ...(list.length ? [] : [h("li", { class: "muted small" }, "No requests yet.")]),
      ...list.map((r) =>
        h(
          "li",
          { "data-request": r.id },
          avatar(r.user, "sm"),
          h("span", { class: "grow" }, h("strong", {}, r.user.displayName), h("br"), h("small", { class: "muted" }, `@${r.user.username}`)),
          r.status === "pending"
            ? h(
                "span",
                { class: "row-actions" },
                h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-request-action": "reject", onclick: () => decide(r, "reject") }, "Reject"),
                h("button", { class: "btn btn-primary btn-sm", type: "button", "data-request-action": "approve", onclick: () => decide(r, "approve") }, "Approve"),
              )
            : h("span", { class: `chip ${r.status === "approved" ? "chip-live" : "chip-soft"}`, "data-status": r.status }, REQ_LABEL[r.status]),
        ),
      ),
    );
  const loadRequests = () => isOwner && api(`${base}/requests`).then((r) => renderRequests(r.requests)).catch(() => {});
  const decide = async (r, what) => {
    for (const b of requests.querySelectorAll(`[data-request="${r.id}"] button`)) b.disabled = true;
    try {
      const res = await api(`${base}/requests/${r.id}/${what}`, { method: "POST", body: {} });
      toast(what === "approve" ? `${r.user.displayName} can now plan this trip with you.` : `Request from ${r.user.displayName} rejected.`);
      renderRequests(res.requests);
    } catch (err) {
      toast(err.message, { kind: "error" });
      loadRequests();
    }
  };

  const list = h("ul", { class: "members" });
  const renderMembers = () =>
    list.replaceChildren(
      ...S.trip.members.map((m) =>
        h(
          "li",
          {},
          avatar(m),
          h("span", { class: "grow" }, h("strong", {}, m.displayName), m.id === me.id && " (you)", h("br"), h("small", { class: "muted" }, m.role === "owner" ? "Owner" : "Collaborator")),
          S.presence.some((p) => p.id === m.id) && h("span", { class: "chip chip-live" }, "Here now"),
          m.role !== "owner" &&
            (isOwner || m.id === me.id) &&
            h(
              "button",
              {
                class: "btn btn-ghost btn-sm btn-danger-text",
                type: "button",
                onclick: async () => {
                  if (!confirm(m.id === me.id ? "Leave this trip?" : `Remove ${m.displayName} from this trip?`)) return;
                  await act(api(`${base}/members/${m.id}`, { method: "DELETE" })).catch(() => {});
                  if (m.id === me.id) navigate("/", { replace: true });
                  else renderMembers();
                },
              },
              m.id === me.id ? "Leave" : "Remove",
            ),
        ),
      ),
    );
  renderMembers();
  renderLink(null, null);
  loadLink();
  loadRequests();

  // --- invite by nickname: search, choose, then an explicit Invite ---
  const STATUS = { you: "You", member: "Already a member", invited: "Invited", available: null };
  const nameInput = h("input", { type: "search", class: "invitee-input", placeholder: "Search by nickname", "aria-label": "Search by nickname", autocomplete: "off", spellcheck: "false", maxlength: 80 });
  const results = h("ul", { class: "invitee-results", role: "listbox", "aria-label": "Matching accounts" });
  const searchNote = h("p", { class: "small muted", role: "status", "aria-live": "polite" }, "Enter their nickname. A single character matches that exact nickname.");
  const sent = h("ul", { class: "invitations" });
  let chosen = null;
  let seq = 0;
  let timer = null;
  const inviteBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", "data-share": "invite", disabled: true }, "Invite");
  const choose = (r) => {
    chosen = r;
    for (const li of results.children) li.setAttribute("aria-selected", String(li.dataset.user === r?.id));
    inviteBtn.disabled = !r || r.status !== "available";
    inviteBtn.textContent = r && r.status !== "available" ? STATUS[r.status] : "Invite";
    inviteBtn.setAttribute("aria-label", r?.status === "available" ? `Invite ${r.displayName}` : inviteBtn.textContent);
  };
  const resultRow = (r) =>
    h(
      "li",
      {
        class: "invitee",
        role: "option",
        tabindex: 0,
        "aria-selected": "false",
        "data-user": r.id,
        "aria-disabled": String(r.status !== "available"),
        onclick: () => choose(r),
        onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose(r)),
      },
      avatar(r, "sm"),
      h("span", { class: "grow" }, h("strong", {}, r.displayName), h("br"), h("small", { class: "muted" }, `@${r.username}`)),
      STATUS[r.status] && h("span", { class: `chip ${r.status === "invited" ? "chip-soft" : ""}` }, STATUS[r.status]),
    );
  const search = () => {
    clearTimeout(timer);
    const mine = ++seq; // invalidate an old response before the new debounce
    choose(null);
    results.replaceChildren();
    const q = nameInput.value.trim();
    if (!q) {
      searchNote.textContent = "Enter their nickname. A single character matches that exact nickname.";
      return;
    }
    if ([...q].length > 40) {
      searchNote.textContent = "Nicknames have at most 40 characters.";
      return;
    }
    searchNote.textContent = "Searching…";
    timer = setTimeout(async () => {
      try {
        const r = await api(`${base}/invitees?${new URLSearchParams({ q })}`);
        if (mine !== seq || !dialog.open) return;
        results.replaceChildren(...r.results.map(resultRow));
        searchNote.textContent = r.results.length ? "Check the nickname and @username, then choose an account and press Invite." : `No nickname matches “${q}”.`;
      } catch (err) {
        if (mine !== seq || !dialog.open) return;
        results.replaceChildren();
        searchNote.textContent = err.message;
      }
    }, 300);
  };
  nameInput.addEventListener("input", search);
  const LABEL = { pending: "Invited", accepted: "Accepted", declined: "Declined", cancelled: "Cancelled" };
  const loadSent = async () => {
    try {
      const { invitations } = await api(`${base}/invitations`);
      sent.replaceChildren(
        ...invitations.map((i) =>
          h(
            "li",
            { "data-invitation": i.id },
            avatar(i.user, "sm"),
            h("span", { class: "grow" }, h("strong", {}, i.user.displayName), h("br"), h("small", { class: "muted" }, `@${i.user.username}`)),
            h("span", { class: `chip ${i.status === "accepted" ? "chip-live" : "chip-soft"}`, "data-status": i.status }, LABEL[i.status]),
            i.status === "pending" &&
              h(
                "button",
                {
                  class: "btn btn-ghost btn-sm",
                  type: "button",
                  "data-share": "cancel",
                  "aria-label": `Cancel the invitation to @${i.user.username}`,
                  onclick: async (e) => {
                    e.target.disabled = true;
                    await api(`${base}/invitations/${i.id}`, { method: "DELETE" }).catch((err) => toast(err.message, { kind: "error" }));
                    loadSent();
                    if (nameInput.value.trim()) search();
                  },
                },
                "Cancel",
              ),
          ),
        ),
      );
    } catch {
      // the list is a convenience; the invitations themselves are safe
    }
  };
  inviteBtn.addEventListener("click", async () => {
    if (!chosen || chosen.status !== "available") return;
    const who = chosen;
    inviteBtn.disabled = true;
    try {
      await api(`${base}/invitations`, { method: "POST", body: { userId: who.id } });
      // the search is done with; the sent list below keeps the "Invited" state
      seq++;
      nameInput.value = "";
      results.replaceChildren();
      choose(null);
      searchNote.textContent = `Invitation sent to ${who.displayName} (@${who.username}). They'll see it in My Trips.`;
      await loadSent();
    } catch (err) {
      searchNote.textContent = err.message;
      if (err.status === 409) search();
      else inviteBtn.disabled = false;
    }
  });
  const byName = isOwner && h(
    "section",
    { class: "share-method", "aria-labelledby": "share-by-name" },
    h("h3", { id: "share-by-name" }, "Invite by nickname"),
    h("p", { class: "small muted" }, "Search for the nickname they entered as “Your name” when registering. Check the @username shown below each result to confirm the account. They join when they accept in My Trips."),
    h("div", { class: "invitee-search" }, nameInput, inviteBtn),
    searchNote,
    results,
    sent,
  );
  const byLink = isOwner && h(
    "section",
    { class: "share-method", "aria-labelledby": "share-by-link" },
    h("h3", { id: "share-by-link" }, "Invite by link"),
    linkBox,
    h("h4", { class: "small" }, "Requests to join"),
    requests,
  );
  if (isOwner) loadSent();
  // someone accepted while this was open: their status and the member list
  // follow, a tick later so the editor has applied the snapshot first
  const following = new Set();
  const follow = () => {
    if (!dialog.open) return;
    renderMembers();
    if (isOwner) {
      loadSent();
      loadRequests();
    }
  };
  const onSnap = () => {
    const t = setTimeout(() => {
      following.delete(t);
      follow();
    }, 0);
    following.add(t);
  };
  events.addEventListener("snapshot", onSnap);

  const dialog = openDialog(
    h(
      "dialog",
      { class: "dialog dialog-share" },
      h(
        "div",
        { class: "stack" },
        h("h2", {}, "People on this trip"),
        list,
        h("p", { class: "small muted", "data-share": "view-note" }, "While others have this trip open, they see roughly where your map is looking (its centre and zoom, never your location), and you see theirs. Your “My spot” stays on your screen only."),
        isOwner ? byName : h("p", { class: "small muted" }, "Only the owner can invite people. As a collaborator you can add stops and change the ones you added."),
        byLink,
        h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => dialog.close() }, "Done")),
      ),
    ),
  );
  dialog.addEventListener("close", () => {
    events.removeEventListener("snapshot", onSnap);
    for (const t of following) clearTimeout(t);
    following.clear();
    clearTimeout(timer);
    seq++;
    choose(null);
    results.replaceChildren();
  });
}

// Publishing: a read-only snapshot for others to browse, review and copy.
// Editing this trip afterwards never changes it until "Update published".
export async function publishDialog({ S, base, applySnapshot, navigate }) {
  const t = S.trip;
  let pub = null;
  try {
    pub = (await api(`${base}/publication`)).publication;
  } catch (err) {
    return toast(err.message, { kind: "error" });
  }
  const live = pub?.status === "published";
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const hasStops = t.days.some((d) => d.activities.some((a) => a.role !== "start"));
  const form = h(
    "form",
    { method: "dialog", class: "stack" },
    h("h2", {}, live ? "Published trip" : "Publish Trip"),
    h(
      "p",
      { class: "small muted" },
      "Publishing shares a read-only copy of this plan: title, destination, stops, times and places, with you named as the author. Notes, the people on this trip and invite links stay private. Anyone can view it, rate it and copy it into their own trip; nobody can edit yours.",
    ),
    live &&
      h(
        "p",
        { class: "small", "data-publish": "state" },
        `Published ${new Date(pub.publishedAt).toLocaleString()}. `,
        t.publication?.outdated ? h("strong", {}, "You've changed the trip since; the public version still shows the earlier plan.") : "It matches the current plan.",
        " ",
        h("a", { href: `/itineraries/${pub.id}`, "data-link": true, onclick: () => dialog.close() }, "View public page"),
      ),
    pub?.status === "unpublished" && h("p", { class: "small muted" }, "Unpublished: hidden from others. Copies people already made are theirs to keep."),
    h("label", { class: "field" }, h("span", {}, "Description"), h("textarea", { name: "description", required: true, maxlength: 600, rows: 3, placeholder: "What makes this trip worth copying?" }, pub?.description ?? "")),
    !hasStops && h("p", { class: "small leg-warn" }, "Add at least one stop before publishing."),
    error,
    h(
      "div",
      { class: "dialog-actions" },
      live && h("button", { class: "btn btn-ghost btn-danger-text", type: "button", "data-publish": "unpublish", onclick: unpublish }, "Unpublish"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"),
      h("button", { class: "btn btn-primary", type: "submit", "data-publish": "submit", disabled: !hasStops }, live ? "Update published version" : pub ? "Publish again" : "Publish"),
    ),
  );
  const dialog = openDialog(h("dialog", { class: "dialog" }, form));
  async function unpublish() {
    if (!confirm("Unpublish this trip? It disappears from Wayline for others; copies already made stay with their owners.")) return;
    try {
      await api(`${base}/publication`, { method: "DELETE" });
      dialog.close();
      toast("Unpublished.");
      applySnapshot(await api(base));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api(`${base}/publication`, { method: "PUT", body: { description: form.description.value } });
      dialog.close();
      toast(live ? "Published version updated." : "Published. Others can now find and copy it.");
      applySnapshot(await api(base));
      if (!live) navigate(`/itineraries/${r.publication.id}`);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}
