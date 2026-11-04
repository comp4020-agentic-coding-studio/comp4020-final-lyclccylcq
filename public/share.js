import { locale, t } from "/i18n.js";
import { api, avatar, h, icon, openDialog, toast } from "/ui.js";

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
    if (left <= 0) return t("Link expired.");
    const mins = Math.max(1, Math.ceil(left / 60_000));
    const h_ = Math.floor(mins / 60);
    const m = mins % 60;
    const when = new Date(link.expiresAt).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const left_ = `${h_ ? t("{h} h", { h: h_ }) : ""}${h_ && m ? " " : ""}${m || !h_ ? t("{m} min", { m }) : ""}`;
    return t("Active until {when} ({left} left)", { when, left: left_ });
  };
  // token: shown once, right after it's made; link: its times, from the server
  const renderLink = (token, link) => {
    linkBox.replaceChildren();
    if (!isOwner) return;
    linkBox.append(h("p", { class: "small", "data-share": "approval-note" }, t("Lasts 24 hours. People ask to join; you approve them.")));
    if (token) {
      const url = `${location.origin}/join/${token}`;
      const input = h("input", { readonly: true, value: url, "aria-label": t("Invite link"), onfocus: (e) => e.target.select() });
      linkBox.append(
        h("div", { class: "copy-row" }, input, h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: async () => { await navigator.clipboard?.writeText(url).catch(() => {}); input.select(); toast(t("Invite link copied.")); } }, t("Copy"))),
        h("p", { class: "small muted" }, t("Copy it now; it's shown once.")),
      );
    }
    if (link) linkBox.append(h("p", { class: `small ${link.expired ? "leg-warn" : "muted"}`, "data-share": "expiry" }, expiry(link)));
    const live = link && !link.expired;
    linkBox.append(
      h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-outline btn-sm", type: "button", "data-share": "new-link", onclick: async () => { const r = await act(api(`${base}/invite`, { method: "POST", body: {} })); renderLink(r.token, r.link); } }, link ? t("Create a new link") : t("Create invite link")),
        (live || token) && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => { await act(api(`${base}/invite`, { method: "DELETE" })); toast(t("Invite link turned off.")); renderLink(null, null); } }, t("Turn off link")),
      ),
    );
  };
  const loadLink = () => isOwner && api(`${base}/invite`).then((r) => renderLink(null, r.link)).catch(() => {});

  // requests to join through a link
  const requests = h("ul", { class: "invitations", "data-share": "requests" });
  const REQ_LABEL = { pending: "Waiting", approved: "Approved", rejected: "Rejected" };
  const renderRequests = (list) =>
    requests.replaceChildren(
      ...(list.length ? [] : [h("li", { class: "muted small" }, t("No requests yet."))]),
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
                h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-request-action": "reject", onclick: () => decide(r, "reject") }, t("Reject")),
                h("button", { class: "btn btn-primary btn-sm", type: "button", "data-request-action": "approve", onclick: () => decide(r, "approve") }, t("Approve")),
              )
            : h("span", { class: `chip ${r.status === "approved" ? "chip-live" : "chip-soft"}`, "data-status": r.status }, t(REQ_LABEL[r.status])),
        ),
      ),
    );
  const loadRequests = () => isOwner && api(`${base}/requests`).then((r) => renderRequests(r.requests)).catch(() => {});
  const decide = async (r, what) => {
    for (const b of requests.querySelectorAll(`[data-request="${r.id}"] button`)) b.disabled = true;
    try {
      const res = await api(`${base}/requests/${r.id}/${what}`, { method: "POST", body: {} });
      toast(what === "approve" ? t("{name} can now plan this trip with you.", { name: r.user.displayName }) : t("Request from {name} rejected.", { name: r.user.displayName }));
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
          h("span", { class: "grow" }, h("strong", {}, m.displayName), m.id === me.id && t(" (you)"), h("br"), h("small", { class: "muted" }, m.role === "owner" ? t("Owner") : t("Collaborator"))),
          S.presence.some((p) => p.id === m.id) && h("span", { class: "chip chip-live" }, t("Here now")),
          m.role !== "owner" &&
            (isOwner || m.id === me.id) &&
            h(
              "button",
              {
                class: "btn btn-ghost btn-sm btn-danger-text",
                type: "button",
                onclick: async () => {
                  if (!confirm(m.id === me.id ? t("Leave this trip?") : t("Remove {name} from this trip?", { name: m.displayName }))) return;
                  await act(api(`${base}/members/${m.id}`, { method: "DELETE" })).catch(() => {});
                  if (m.id === me.id) navigate("/", { replace: true });
                  else renderMembers();
                },
              },
              m.id === me.id ? t("Leave") : t("Remove"),
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
  const nameInput = h("input", { type: "search", class: "invitee-input", placeholder: t("Search by nickname"), "aria-label": t("Search by nickname"), autocomplete: "off", spellcheck: "false", maxlength: 80 });
  const results = h("ul", { class: "invitee-results", role: "listbox", "aria-label": t("Matching accounts") });
  const searchNote = h("p", { class: "small muted", role: "status", "aria-live": "polite" }, "");
  const sent = h("ul", { class: "invitations" });
  let chosen = null;
  let seq = 0;
  let timer = null;
  const inviteBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", "data-share": "invite", disabled: true }, t("Invite"));
  const choose = (r) => {
    chosen = r;
    for (const li of results.children) li.setAttribute("aria-selected", String(li.dataset.user === r?.id));
    inviteBtn.disabled = !r || r.status !== "available";
    inviteBtn.textContent = r && r.status !== "available" ? t(STATUS[r.status]) : t("Invite");
    inviteBtn.setAttribute("aria-label", r?.status === "available" ? t("Invite {name}", { name: r.displayName }) : inviteBtn.textContent);
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
      STATUS[r.status] && h("span", { class: `chip ${r.status === "invited" ? "chip-soft" : ""}` }, t(STATUS[r.status])),
    );
  const search = () => {
    clearTimeout(timer);
    const mine = ++seq; // invalidate an old response before the new debounce
    choose(null);
    results.replaceChildren();
    const q = nameInput.value.trim();
    if (!q) {
      searchNote.textContent = "";
      return;
    }
    if ([...q].length > 40) {
      searchNote.textContent = t("Nicknames have at most 40 characters.");
      return;
    }
    searchNote.textContent = t("Searching…");
    timer = setTimeout(async () => {
      try {
        const r = await api(`${base}/invitees?${new URLSearchParams({ q })}`);
        if (mine !== seq || !dialog.open) return;
        results.replaceChildren(...r.results.map(resultRow));
        searchNote.textContent = r.results.length ? "" : t("No nickname matches “{q}”.", { q });
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
            h("span", { class: `chip ${i.status === "accepted" ? "chip-live" : "chip-soft"}`, "data-status": i.status }, t(LABEL[i.status])),
            i.status === "pending" &&
              h(
                "button",
                {
                  class: "btn btn-ghost btn-sm",
                  type: "button",
                  "data-share": "cancel",
                  "aria-label": t("Cancel the invitation to @{username}", { username: i.user.username }),
                  onclick: async (e) => {
                    e.target.disabled = true;
                    await api(`${base}/invitations/${i.id}`, { method: "DELETE" }).catch((err) => toast(err.message, { kind: "error" }));
                    loadSent();
                    loadCompanions();
                    if (nameInput.value.trim()) search();
                  },
                },
                t("Cancel"),
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
      searchNote.textContent = t("Invitation sent to {name}.", { name: who.displayName });
      await Promise.all([loadSent(), loadCompanions()]);
    } catch (err) {
      searchNote.textContent = err.message;
      if (err.status === 409) search();
      else inviteBtn.disabled = false;
    }
  });
  // people you've travelled with on your other trips, in a menu beside the
  // search: one click invites, and the dialog stays short
  const companions = h("ul", { class: "companions", id: "share-companions", role: "list", "aria-label": t("People you've travelled with") });
  const companionsCount = h("span", { class: "companions-count" });
  const companionsBtn = h(
    "button",
    { class: "btn btn-ghost btn-sm companions-toggle", type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-controls": "share-companions", "data-share": "companions" },
    icon("share"),
    h("span", { class: "companions-label" }, t("Travelled with")),
    companionsCount,
    h("span", { class: "companions-caret", "aria-hidden": "true" }, icon("chevron")),
  );
  const companionsPop = h("div", { class: "companions-pop", hidden: true }, companions);
  const companionsBox = h("div", { class: "companions-box", hidden: true }, companionsBtn, companionsPop);
  const closeCompanions = () => {
    companionsPop.hidden = true;
    companionsBtn.setAttribute("aria-expanded", "false");
  };
  companionsBtn.addEventListener("click", () => {
    const open = companionsPop.hidden;
    companionsPop.hidden = !open;
    companionsBtn.setAttribute("aria-expanded", String(open));
    if (open) companions.querySelector("button")?.focus();
  });
  // Escape closes the menu first, not the whole dialog; a click elsewhere closes it
  companionsBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !companionsPop.hidden) {
      e.preventDefault();
      e.stopPropagation();
      closeCompanions();
      companionsBtn.focus();
    }
  });
  const outsideCompanions = (e) => !companionsBox.contains(e.target) && closeCompanions();
  const loadCompanions = async () => {
    try {
      const { people } = await api(`${base}/companions`);
      if (!dialog.open) return;
      companionsBox.hidden = people.length === 0;
      const open = people.filter((p) => p.status === "available").length;
      companionsCount.textContent = String(open || people.length);
      companionsBtn.setAttribute("aria-label", t("People you've travelled with ({n})", { n: people.length }));
      companions.replaceChildren(
        ...people.map((p) =>
          h(
            "li",
            { class: "companion", "data-companion": p.id },
            avatar(p, "sm"),
            h("span", { class: "grow" }, h("strong", {}, p.displayName), h("br"), h("small", { class: "muted" }, `@${p.username}`)),
            p.status === "available"
              ? h(
                  "button",
                  {
                    class: "btn btn-ghost btn-sm",
                    type: "button",
                    "data-share": "invite-companion",
                    "aria-label": t("Invite {name}", { name: p.displayName }),
                    onclick: async (e) => {
                      e.currentTarget.disabled = true;
                      try {
                        await api(`${base}/invitations`, { method: "POST", body: { userId: p.id } });
                        searchNote.textContent = t("Invitation sent to {name}.", { name: p.displayName });
                      } catch (err) {
                        searchNote.textContent = err.message;
                      }
                      await Promise.all([loadSent(), loadCompanions()]);
                    },
                  },
                  t("Invite"),
                )
              : h("span", { class: "chip chip-soft" }, t(STATUS[p.status])),
          ),
        ),
        h("li", { class: "companions-more small muted" }, t("Someone else? Search by nickname.")),
      );
    } catch {
      // a convenience: searching by nickname still works
    }
  };
  const byName = isOwner && h(
    "section",
    { class: "share-method", "aria-labelledby": "share-by-name" },
    h("h3", { id: "share-by-name" }, t("Invite by nickname")),
    h("div", { class: "invitee-search" }, nameInput, inviteBtn),
    companionsBox,
    searchNote,
    results,
    sent,
  );
  const byLink = isOwner && h(
    "section",
    { class: "share-method", "aria-labelledby": "share-by-link" },
    h("h3", { id: "share-by-link" }, t("Invite by link")),
    linkBox,
    h("h4", { class: "small" }, t("Requests to join")),
    requests,
  );
  if (isOwner) {
    loadSent();
    queueMicrotask(() => {
      // once the dialog is open
      loadCompanions();
      dialog.addEventListener("click", outsideCompanions);
    });
  }
  // someone accepted while this was open: their status and the member list
  // follow, a tick later so the editor has applied the snapshot first
  const following = new Set();
  const follow = () => {
    if (!dialog.open) return;
    renderMembers();
    if (isOwner) {
      loadSent();
      loadRequests();
      loadCompanions();
    }
  };
  const onSnap = () => {
    const tm = setTimeout(() => {
      following.delete(tm);
      follow();
    }, 0);
    following.add(tm);
  };
  events.addEventListener("snapshot", onSnap);

  const dialog = openDialog(
    h(
      "dialog",
      { class: "dialog dialog-share" },
      h(
        "div",
        { class: "stack" },
        h("h2", {}, t("People on this trip")),
        list,
        h("p", { class: "small muted", "data-share": "view-note" }, t("Others here see where your map is looking, never your location.")),
        isOwner ? byName : h("p", { class: "small muted" }, t("Only the owner can invite people.")),
        byLink,
        h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => dialog.close() }, t("Done"))),
      ),
    ),
  );
  dialog.addEventListener("close", () => {
    events.removeEventListener("snapshot", onSnap);
    for (const tm of following) clearTimeout(tm);
    following.clear();
    clearTimeout(timer);
    seq++;
    choose(null);
    results.replaceChildren();
  });
}

// Publishing: a read-only snapshot of the plan, a journey to share. It's a
// different thing from inviting people to edit (shareDialog above): a
// journey's link lets anyone read it and nobody change it. Link-only by
// default; listing it puts it under Shared by travellers too. Editing this
// trip afterwards never changes it until "Update published version".
export async function publishDialog({ S, base, applySnapshot }) {
  const trip = S.trip;
  let pub = null;
  try {
    pub = (await api(`${base}/publication`)).publication;
  } catch (err) {
    return toast(err.message, { kind: "error" });
  }
  const live = pub?.status === "published";
  const url = (id) => `${location.origin}/journeys/${id}`;
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const hasStops = trip.days.some((d) => d.activities.some((a) => a.role !== "start"));
  const vis = pub?.visibility ?? "link";
  const choice = (value, title, note) =>
    h("label", { class: "pub-choice" }, h("input", { type: "radio", name: "visibility", value, checked: vis === value }), h("span", {}, h("strong", {}, title), h("small", { class: "muted" }, note)));
  const form = h(
    "form",
    { method: "dialog", class: "stack" },
    h("h2", {}, live ? t("Your published journey") : t("Publish as a journey")),
    h("p", { class: "small muted" }, t("A read-only page of this plan as it is now, to share with anyone. It never lets people edit: to plan together, use Share. Notes and the people on the trip stay private.")),
    live &&
      h(
        "div",
        { class: "pub-live", "data-publish": "state" },
        h("p", { class: "small" }, t("Published {when}. ", { when: new Date(pub.publishedAt).toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) }), trip.publication?.outdated ? h("strong", {}, t("You've changed the trip since; the journey still shows the earlier plan.")) : t("It matches the current plan.")),
        h("div", { class: "pub-link" }, h("input", { type: "text", readonly: true, value: url(pub.id), "aria-label": t("Journey link"), onfocus: (e) => e.target.select() }), h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-publish": "copy", onclick: () => copy(url(pub.id)) }, t("Copy link")), h("a", { class: "btn btn-quiet btn-sm", href: `/journeys/${pub.id}`, target: "_blank", rel: "noopener" }, t("Preview"))),
      ),
    pub?.status === "unpublished" && h("p", { class: "small muted" }, t("Unpublished: its link shows nothing until you publish again.")),
    h("fieldset", { class: "pub-choices" }, h("legend", { class: "small" }, t("Who can find it")), choice("link", t("Anyone with the link"), t("Not listed anywhere. Share the link with who you like.")), choice("listed", t("Listed on Wayline"), t("Also shown under Shared by travellers, where others can rate and copy it."))),
    h("label", { class: "field" }, h("span", {}, t("A line about it")), h("textarea", { name: "description", required: true, maxlength: 600, rows: 3, placeholder: t("What made this trip special?") }, pub?.description ?? "")),
    !hasStops && h("p", { class: "small leg-warn" }, t("Add at least one stop before publishing.")),
    error,
    h(
      "div",
      { class: "dialog-actions" },
      live && h("button", { class: "btn btn-ghost btn-danger-text", type: "button", "data-publish": "unpublish", onclick: unpublish }, t("Unpublish")),
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, t("Cancel")),
      h("button", { class: "btn btn-primary", type: "submit", "data-publish": "submit", disabled: !hasStops }, live ? t("Update published version") : pub ? t("Publish again") : t("Publish")),
    ),
  );
  const dialog = openDialog(h("dialog", { class: "dialog" }, form));
  async function copy(link) {
    try {
      await navigator.clipboard.writeText(link);
      toast(t("Link copied. It opens a read-only journey."));
    } catch {
      prompt(t("Copy this link:"), link);
    }
  }
  async function unpublish() {
    if (!confirm(t("Unpublish this journey? Its link stops showing it; your trip and copies others made stay as they are."))) return;
    try {
      await api(`${base}/publication`, { method: "DELETE" });
      dialog.close();
      toast(t("Unpublished. Your trip is untouched."));
      applySnapshot(await api(base));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api(`${base}/publication`, { method: "PUT", body: { description: form.description.value, visibility: form.visibility.value } });
      applySnapshot(await api(base));
      dialog.close();
      if (live) return toast(t("Published version updated."));
      // first publication: show its link, ready to copy
      publishedDialog(url(r.publication.id), r.publication.id, copy);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

function publishedDialog(link, id, copy) {
  const dialog = openDialog(
    h(
      "dialog",
      { class: "dialog" },
      h(
        "form",
        { method: "dialog", class: "stack" },
        h("h2", {}, t("Your journey is published")),
        h("p", { class: "small muted" }, t("Anyone with this link can read it. Nobody can edit it, and your trip keeps changing only for you and your crew until you update the journey.")),
        h("div", { class: "pub-link" }, h("input", { type: "text", readonly: true, value: link, "aria-label": t("Journey link"), onfocus: (e) => e.target.select() }), h("button", { class: "btn btn-primary btn-sm", type: "button", "data-publish": "copy", onclick: () => copy(link) }, t("Copy link"))),
        h("div", { class: "dialog-actions" }, h("a", { class: "btn btn-ghost", href: `/journeys/${id}`, target: "_blank", rel: "noopener" }, t("Preview the journey")), h("span", { class: "spacer" }), h("button", { class: "btn btn-ghost", type: "submit" }, t("Done"))),
      ),
    ),
  );
  return dialog;
}
