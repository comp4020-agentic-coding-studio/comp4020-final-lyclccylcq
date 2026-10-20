// Keep the original preview address useful after the journey joined the
// homepage. It uses the same renderer, assets and controls as the homepage.
import { renderHome } from "/home.js";

export function renderPixelTrain(app, ctx) {
  return renderHome(app, ctx);
}
