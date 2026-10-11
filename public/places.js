import { api, fill, fmtDay, guessKind, h, hhmm, icon, KIND_DURATION, KIND_LABEL, openDialog, parseTime, toast, uid } from "/ui.js";

// The place inspector. Details (hours, address, photo) are fetched from
// Google only when someone opens it, never for every result on screen.
// place: { placeId | null, name, lat, lng, source, note?, query? }
export function placeDialog(place, ctx = null) {
  const body = h("div", { class: "stack" }, h("p", { class: "muted small" }, "Loading place details…"));
  const dialog = openDialog(
    h(
      "dialog",
      { class: "dialog place-dialog", "aria-label": place.name },
      h(
        "div",
        { class: "stack" },
        h("div", { class: "panel-row" }, h("h2", {}, place.name), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => dialog.close() }, icon("close"))),
        body,
      ),
    ),
  );
  const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.query ?? `${place.name}`)}`;

  if (!place.placeId || place.source === "curated") {
    fill(
      body,
      place.note && h("p", {}, place.note),
      h(
        "p",
        { class: "demo-note" },
        h("strong", {}, "Approximate location."),
        " This stop comes from Wayline's curated sample data and hasn't been matched to a Google place yet, so there are no opening hours or photos here.",
      ),
      h("p", {}, h("a", { href: mapsSearch, target: "_blank", rel: "noopener" }, "Search for it on Google Maps")),
    );
    return dialog;
  }

  api(`/api/places/${encodeURIComponent(place.placeId)}`)
    .then(async (d) => {
      const photoBox = h("div", { class: "place-photo" });
      fill(
        body,
        d.photo && photoBox,
        h("p", { class: "stop-meta" }, d.category && h("span", { class: "tag" }, d.category), d.source === "demo" && h("span", { class: "tag tag-demo" }, "Demo place")),
        place.note && h("p", {}, place.note),
        d.address && h("p", { class: "muted" }, d.address),
        typeof d.rating === "number" && h("p", { class: "rating" }, h("strong", {}, d.rating.toFixed(1)), " ★", d.ratingCount ? h("span", { class: "muted" }, ` (${d.ratingCount.toLocaleString("en-AU")} Google reviews)`) : null),
        d.openingHours
          ? h(
              "details",
              { class: "hours", open: true },
              h("summary", {}, d.openNow === true ? "Open now · opening hours" : d.openNow === false ? "Closed now · opening hours" : "Opening hours"),
              h("ul", {}, d.openingHours.map((line) => h("li", {}, line))),
            )
          : h("p", { class: "muted small" }, d.source === "demo" ? "Demo places have no opening hours." : "No opening hours available for this place."),
        h(
          "div",
          { class: "row-actions" },
          ctx && h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { dialog.close(); addToTripDialog(d, ctx); } }, icon("plus"), "Add to Trip"),
          h("a", { class: "btn btn-ghost btn-sm", href: d.googleMapsUri ?? mapsSearch, target: "_blank", rel: "noopener" }, "Open in Google Maps"),
        ),
        d.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
      );
      if (d.photo) {
        try {
          const { uri } = await api(`/api/places/photo?name=${encodeURIComponent(d.photo.name)}`);
          fill(
            photoBox,
            h("img", { src: uri, alt: `Photo of ${d.name}`, loading: "lazy", decoding: "async", onerror: () => photoBox.remove() }),
            d.photo.attributions.length > 0 &&
              h(
                "p",
                { class: "photo-credit" },
                "Photo: ",
                d.photo.attributions.map((a, i) => [i > 0 && ", ", a.uri ? h("a", { href: a.uri, target: "_blank", rel: "noopener" }, a.displayName) : a.displayName]),
              ),
          );
        } catch {
          photoBox.remove();
        }
      }
    })
    .catch((err) => {
      body.replaceChildren(h("p", { class: "form-error" }, err.message), h("p", {}, h("a", { href: mapsSearch, target: "_blank", rel: "noopener" }, "Search for it on Google Maps")));
    });
  return dialog;
}

// Adds a place to one of the user's trips as a new activity. Only the place
// id, the user's chosen title and a temporary copy of the coordinates are
// stored; details stay with Google.
// place: { placeId, name, lat, lng, source: "google" | "demo", types? }
export async function addToTripDialog(place, ctx) {
  if (!ctx.me) return ctx.navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
  const body = h("div", { class: "stack" }, h("p", { class: "muted small", role: "status" }, "Loading your trips…"));
  const dialog = openDialog(h("dialog", { class: "dialog", "aria-label": `Add ${place.name} to a trip` }, h("div", { class: "stack" }, h("h2", {}, "Add to Trip"), h("p", { class: "muted" }, place.name), body)));
  let trips;
  try {
    const { owned, shared } = await api("/api/trips");
    trips = [...owned, ...shared].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    return body.replaceChildren(h("p", { class: "form-error" }, err.message));
  }
  if (!trips.length) {
    return body.replaceChildren(
      h("p", {}, "You don't have a trip yet. Create one first, then add places to it."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"), h("button", { class: "btn btn-primary", type: "button", onclick: () => { dialog.close(); ctx.createTrip(); } }, "Create a trip")),
    );
  }
  const kind = guessKind(place.types ?? []);
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const tripSel = h("select", { name: "trip" }, trips.map((t) => h("option", { value: t.id }, `${t.title} · ${t.destination}`)));
  const daySel = h("select", { name: "day", disabled: true });
  const start = h("input", { name: "start", type: "time", step: 300, value: "09:00" });
  const kindSel = h("select", { name: "kind" }, Object.entries(KIND_LABEL).map(([k, v]) => h("option", { value: k, selected: k === kind }, v)));
  const duration = h("input", { name: "duration", type: "number", min: 5, max: 1440, step: 5, value: KIND_DURATION[kind] });
  const submit = h("button", { class: "btn btn-primary", type: "submit", disabled: true }, "Add");
  let trip = null;
  const loadTrip = async () => {
    daySel.disabled = true;
    submit.disabled = true;
    try {
      trip = await api(`/api/trips/${tripSel.value}`);
      daySel.replaceChildren(...trip.days.map((d, i) => h("option", { value: d.id }, `Day ${i + 1} · ${fmtDay(d.date)}`)));
      daySel.disabled = false;
      submit.disabled = false;
      suggest();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
  const suggest = () => {
    const day = trip?.days.find((d) => d.id === daySel.value);
    const timed = (day?.activities ?? []).filter((a) => a.startMin !== null);
    const end = timed.length ? Math.max(...timed.map((a) => a.startMin + a.durationMin)) : 9 * 60;
    start.value = hhmm(Math.min(Math.ceil(end / 15) * 15, 23 * 60 + 45));
  };
  tripSel.addEventListener("change", loadTrip);
  daySel.addEventListener("change", suggest);
  kindSel.addEventListener("change", () => (duration.value = KIND_DURATION[kindSel.value]));
  const clientId = uid();
  const form = h(
    "form",
    { class: "stack" },
    h("label", { class: "field" }, h("span", {}, "Trip"), tripSel),
    h("div", { class: "row-2" }, h("label", { class: "field" }, h("span", {}, "Day"), daySel), h("label", { class: "field" }, h("span", {}, "Type"), kindSel)),
    h("div", { class: "row-2" }, h("label", { class: "field" }, h("span", {}, "Start"), start), h("label", { class: "field" }, h("span", {}, "Duration (min)"), duration)),
    error,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"), submit),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      await api(`/api/trips/${trip.id}/activities`, {
        method: "POST",
        body: {
          clientId,
          dayId: daySel.value,
          title: place.name,
          kind: kindSel.value,
          startMin: parseTime(start.value),
          durationMin: Number(duration.value),
          place: { placeId: place.placeId, source: place.source === "demo" ? "demo" : "google", lat: place.lat, lng: place.lng },
        },
      });
      dialog.close();
      toast(`Added ${place.name} to ${trip.title}.`, { action: { label: "Open trip", run: () => ctx.navigate(`/trips/${trip.id}`) } });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });
  body.replaceChildren(form);
  loadTrip();
}
