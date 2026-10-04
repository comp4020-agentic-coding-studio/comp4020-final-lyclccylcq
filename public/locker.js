// Your locker: what the gym remembers about you. It's read from the server
// each time you open it (GET /api/locker, which only ever returns your own),
// and nothing in it is kept in the browser.

import { esc, pad } from "./util.js";

const day = (t) => new Date(t).toLocaleDateString(document.documentElement.lang, { weekday: "short", day: "numeric", month: "short" });
const time = (t) => new Date(t).toLocaleTimeString(document.documentElement.lang, { hour: "numeric", minute: "2-digit" });

function minutes(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// describe(exercise, set) formats a set the way the gym does
export function lockerHtml(data, me, describe) {
  const head = `<div class="locker-head">
      <span class="plate" aria-hidden="true">${pad(data.number)}</span>
      <div><p class="eyebrow">Locker ${pad(data.number)}</p><h2>${esc(me.user.name)}</h2></div>
      <button type="button" class="link" data-act="close-locker">Close</button>
    </div>`;
  if (!data.visits.length) {
    return `${head}<p class="locker-empty">Nothing in here yet. Finish a set and it'll be kept in your locker.</p>`;
  }

  const [latest] = data.visits;
  const open = latest.endedAt == null;
  const stats = `<div class="locker-stats">
      <div><b>${data.visitsThisWeek}</b><span>${data.visitsThisWeek === 1 ? "visit" : "visits"} in the last 7 days</span></div>
      <div><b>${open ? "Now" : esc(day(latest.startedAt))}</b><span>last workout · ${esc(minutes((latest.endedAt ?? latest.lastSetAt) - latest.startedAt))}</span></div>
    </div>`;

  const visits = data.visits
    .map((v, i) => {
      const length = minutes((v.endedAt ?? v.lastSetAt) - v.startedAt);
      const when = v.endedAt == null ? "This visit" : `${day(v.startedAt)} · ${time(v.startedAt)}`;
      const rows = v.exercises
        .map(
          (g) =>
            `<li><b>${esc(g.exercise)}</b><span class="sets">${g.sets.map((s) => `<span>${esc(describe(g.exercise, s))}</span>`).join("")}</span></li>`,
        )
        .join("");
      return `<details class="locker-visit"${i < 2 ? " open" : ""}>
        <summary><span>${esc(when)}</span><span>${esc(length)} · ${v.sets} ${v.sets === 1 ? "set" : "sets"}</span></summary>
        <ul>${rows}</ul>
      </details>`;
    })
    .join("");

  const bests = data.bests.length
    ? `<h3>Heaviest sets</h3><ul class="bests">${data.bests
        .map(
          (b) =>
            `<li><span>${esc(b.exercise)}</span><b>${esc(describe(b.exercise, b))}</b>${b.fromLatestVisit ? `<i>new</i>` : `<em>${esc(day(b.doneAt))}</em>`}</li>`,
        )
        .join("")}</ul>`
    : "";

  return `${head}${stats}<h3>Recent visits</h3>${visits}${bests}`;
}

// Someone else's locker, or a free one: the door, and nothing behind it.
export function lockerDoorHtml(number, taken) {
  return `<div class="locker-head">
      <span class="plate is-shut" aria-hidden="true">${pad(number)}</span>
      <div><p class="eyebrow">Locker ${pad(number)}</p><h2>${taken ? "Someone's locker" : "Free locker"}</h2></div>
      <button type="button" class="link" data-act="close-locker">Close</button>
    </div>
    <p class="locker-empty">${taken ? "It's locked. Only its owner can open it." : "Nobody's using this one."}</p>`;
}
