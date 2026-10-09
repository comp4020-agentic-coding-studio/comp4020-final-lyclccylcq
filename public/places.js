import { api, h, icon, openDialog } from "/ui.js";

// The place inspector. Details (hours, address, photo) are fetched from
// Google only when someone opens it, never for every result on screen.
// place: { placeId | null, name, lat, lng, source, note?, query? }
export function placeDialog(place) {
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
    body.replaceChildren(
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
      body.replaceChildren(
        d.photo && photoBox,
        h("p", { class: "stop-meta" }, d.category && h("span", { class: "tag" }, d.category), d.source === "demo" && h("span", { class: "tag tag-demo" }, "Demo place")),
        place.note && h("p", {}, place.note),
        d.address && h("p", { class: "muted" }, d.address),
        d.openingHours
          ? h(
              "details",
              { class: "hours", open: true },
              h("summary", {}, d.openNow === true ? "Open now · opening hours" : d.openNow === false ? "Closed now · opening hours" : "Opening hours"),
              h("ul", {}, d.openingHours.map((line) => h("li", {}, line))),
            )
          : h("p", { class: "muted small" }, d.source === "demo" ? "Demo places have no opening hours." : "No opening hours available for this place."),
        h("p", {}, h("a", { href: d.googleMapsUri ?? mapsSearch, target: "_blank", rel: "noopener" }, "Open in Google Maps")),
        d.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
      );
      if (d.photo) {
        try {
          const { uri } = await api(`/api/places/photo?name=${encodeURIComponent(d.photo.name)}`);
          photoBox.append(
            h("img", { src: uri, alt: `Photo of ${d.name}`, loading: "lazy" }),
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
