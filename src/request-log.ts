import { flushAfter, log, notes, sanitize } from "./log.ts";

// How an API request becomes a log line (docs/logging.md): the business
// event its route stands for when it worked, or what kind of refusal or
// failure it was when it didn't. Pure classification; src/server.ts calls
// logRequest once each non-stream response has finished. A new user-facing
// route gets a line in ROUTES.

// The business event each API request stands for. Anything not listed (map
// views, place searches, call signalling, polling) logs only when it fails,
// so a live session reads as a list of what people did.
type Route = { event: string; action: string; message: string };
const ROUTES: [string, RegExp, Route][] = [
  ["POST", /^\/api\/auth\/signup$/, { event: "USER_SIGNED_UP", action: "signup", message: "New account created and signed in" }],
  ["POST", /^\/api\/auth\/login$/, { event: "USER_SESSION_CREATED", action: "login", message: "User signed in; new session started" }],
  ["POST", /^\/api\/auth\/logout$/, { event: "USER_SESSION_ENDED", action: "logout", message: "User signed out" }],
  ["POST", /^\/api\/trips$/, { event: "TRIP_CREATED", action: "create_trip", message: "User created a trip" }],
  ["POST", /^\/api\/itineraries\/pub-[0-9a-f-]{36}\/copy$/, { event: "TRIP_FORKED", action: "use_template", message: "User forked a published trip into a new private trip" }],
  ["POST", /^\/api\/itineraries\/[a-z0-9-]+\/copy$/, { event: "TRIP_CREATED", action: "copy_itinerary", message: "User created a trip from a curated itinerary" }],
  ["PUT", /^\/api\/itineraries\/pub-[0-9a-f-]{36}\/reviews$/, { event: "REVIEW_UPDATED", action: "review", message: "User changed their review of a published trip" }],
  ["DELETE", /^\/api\/itineraries\/pub-[0-9a-f-]{36}\/reviews\/[0-9a-f-]{36}$/, { event: "REVIEW_DELETED", action: "delete_review", message: "User deleted their review" }],
  ["GET", /^\/api\/trips\/[0-9a-f-]{36}$/, { event: "TRIP_OPENED", action: "open_trip", message: "User opened the trip" }],
  ["PATCH", /^\/api\/trips\/[0-9a-f-]{36}$/, { event: "TRIP_UPDATED", action: "update_trip", message: "Owner changed the trip's name, dates or settings" }],
  ["DELETE", /^\/api\/trips\/[0-9a-f-]{36}$/, { event: "TRIP_DELETED", action: "delete_trip", message: "Owner deleted the trip" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/invite$/, { event: "INVITATION_CREATED", action: "create_invite_link", message: "Owner created a 24-hour invite link (any earlier link was revoked)" }],
  ["DELETE", /^\/api\/trips\/[0-9a-f-]{36}\/invite$/, { event: "INVITATION_REVOKED", action: "revoke_invite_link", message: "Owner revoked the invite link" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/requests\/[0-9a-f-]{36}\/approve$/, { event: "COLLAB_REQUEST_APPROVED", action: "approve_request", message: "Owner approved a request to join" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/requests\/[0-9a-f-]{36}\/reject$/, { event: "COLLAB_REQUEST_REJECTED", action: "reject_request", message: "Owner rejected a request to join; no access granted" }],
  ["PUT", /^\/api\/trips\/[0-9a-f-]{36}\/publication$/, { event: "TRIP_PUBLISHED", action: "publish_trip", message: "Owner published a snapshot of the trip" }],
  ["DELETE", /^\/api\/trips\/[0-9a-f-]{36}\/publication$/, { event: "TRIP_UNPUBLISHED", action: "unpublish_trip", message: "Owner unpublished the trip; existing forks are unaffected" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/invitations$/, { event: "TRIP_MEMBER_INVITED", action: "invite_user", message: "Owner invited a user by username" }],
  ["DELETE", /^\/api\/trips\/[0-9a-f-]{36}\/invitations\/[0-9a-f-]{36}$/, { event: "TRIP_INVITATION_CANCELLED", action: "cancel_invitation", message: "Owner cancelled an invitation" }],
  ["GET", /^\/api\/invites\/[A-Za-z0-9_-]+$/, { event: "INVITATION_OPENED", action: "open_invite_link", message: "User opened an invite link" }],
  ["POST", /^\/api\/invites\/[A-Za-z0-9_-]+\/(request|accept)$/, { event: "COLLAB_REQUEST_CREATED", action: "request_to_join", message: "User asked to join the trip through an invite link; waiting for the owner" }],
  ["POST", /^\/api\/invitations\/[0-9a-f-]{36}\/accept$/, { event: "COLLAB_TRIP_JOINED", action: "accept_invitation", message: "User accepted an invitation and joined the trip" }],
  ["POST", /^\/api\/invitations\/[0-9a-f-]{36}\/decline$/, { event: "TRIP_INVITATION_DECLINED", action: "decline_invitation", message: "User declined an invitation" }],
  ["DELETE", /^\/api\/trips\/[0-9a-f-]{36}\/members\/[0-9a-f-]{36}$/, { event: "COLLAB_TRIP_LEFT", action: "remove_member", message: "A member left or was removed from the trip" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/activities$/, { event: "TRIP_DESTINATION_ADDED", action: "add_destination", message: "User added a destination to the trip" }],
  ["PATCH", /^\/api\/trips\/[0-9a-f-]{36}\/activities\/[0-9a-f-]{36}$/, { event: "TRIP_DESTINATION_MODIFIED", action: "edit_destination", message: "User edited a destination's details" }],
  ["DELETE", /^\/api\/trips\/[0-9a-f-]{36}\/activities\/[0-9a-f-]{36}$/, { event: "TRIP_DESTINATION_REMOVED", action: "remove_destination", message: "User removed a destination" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/activities\/[0-9a-f-]{36}\/move$/, { event: "TRIP_DESTINATION_REORDERED", action: "reorder_destination", message: "User moved a destination in the plan" }],
  ["PUT", /^\/api\/trips\/[0-9a-f-]{36}\/activities\/[0-9a-f-]{36}\/place$/, { event: "TRIP_DESTINATION_MODIFIED", action: "change_place", message: "User pointed a stop at a different place" }],
  ["PUT", /^\/api\/trips\/[0-9a-f-]{36}\/start$/, { event: "TRIP_START_CHANGED", action: "set_start", message: "User set the trip's starting point" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/routes$/, { event: "TRIP_ROUTE_CALCULATED", action: "calculate_route", message: "User calculated the route between two stops" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/segments\/[0-9a-f-]{36}\/mode$/, { event: "TRIP_ROUTE_MODE_SELECTED", action: "select_mode", message: "User chose a transport mode for a leg" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/proposals\/apply$/, { event: "TRIP_SCHEDULE_MODIFIED", action: "apply_proposal", message: "User applied a schedule fix" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/copilot$/, { event: "COPILOT_ASKED", action: "ask_copilot", message: "User asked the copilot about a day" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/plan$/, { event: "AI_PLAN_DRAFTED", action: "plan_day", message: "User asked the AI to plan a day (preview only)" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/plan\/apply$/, { event: "AI_PLAN_APPLIED", action: "apply_plan", message: "User applied a previewed AI plan" }],
  ["PUT", /^\/api\/trips\/[0-9a-f-]{36}\/preferences$/, { event: "TRIP_PREFERENCES_UPDATED", action: "update_trip_preferences", message: "A member changed the trip's shared travel preferences" }],
  ["PUT", /^\/api\/me\/preferences$/, { event: "USER_PREFERENCES_UPDATED", action: "update_preferences", message: "User saved their own travel preferences" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/call$/, { event: "CALL_INVITED", action: "start_call", message: "User started a voice call" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/call\/[0-9a-f-]{36}\/accept$/, { event: "CALL_ACCEPTED", action: "accept_call", message: "User accepted a voice call" }],
  ["POST", /^\/api\/trips\/[0-9a-f-]{36}\/call\/[0-9a-f-]{36}\/hangup$/, { event: "CALL_ENDED", action: "hang_up", message: "User hung up the voice call" }],
];

const routeFor = (method: string, path: string): Route | undefined => ROUTES.find(([m, re]) => m === method && re.test(path))?.[2];

export const ERROR_CODES: Record<number, string> = {
  400: "INVALID_INPUT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  502: "UPSTREAM_ERROR",
  503: "UNAVAILABLE",
};

// One line per API request worth telling: its business event when it worked,
// or what went wrong when it didn't. 401/403/404 on a trip are "denied"
// (non-members get the same 404 as a missing trip, so that's an attempt on
// a trip the user can't touch); other 4xx are invalid operations; 5xx errors.
export function logRequest(method: string, path: string, status: number, started: number, error?: unknown): void {
  try {
    requestLine(method, path, status, started, error);
  } finally {
    flushAfter();
  }
}

function requestLine(method: string, path: string, status: number, started: number, error?: unknown): void {
  const route = routeFor(method, path);
  const tripId = path.match(/^\/api\/trips\/([0-9a-f-]{36})/)?.[1] ?? null;
  const publicationId = path.match(/^\/api\/itineraries\/(pub-[0-9a-f-]{36})/)?.[1];
  const activityId = path.match(/\/activities\/([0-9a-f-]{36})/)?.[1];
  const extra = notes();
  const durationMs = Math.round(performance.now() - started);
  const { event: _e, action: _a, message: _m, ...details } = extra;
  const base = { tripId, activityId, publicationId, ...details, method, path: path.replace(/\/api\/invites\/[^/]+/, "/api/invites/[token]"), httpStatus: status, durationMs };
  if (status < 400) {
    // the same PUT creates a review (201) or edits the caller's own (200)
    if (route?.event === "REVIEW_UPDATED" && status === 201) {
      log.info("REVIEW_CREATED", { ...base, action: "review", message: "User reviewed a published trip", status: "success" });
      return;
    }
    if (route) log.info(String(extra.event ?? route.event), { ...base, action: String(extra.action ?? route.action), message: String(extra.message ?? route.message), status: "success" });
    return;
  }
  if (status === 499) return; // the browser gave up on its own request
  const event = route ? String(extra.event ?? route.event) : "API_REQUEST";
  const action = String(extra.action ?? route?.action ?? `${method} ${base.path}`);
  const detail = sanitize(error instanceof Error ? error.message : (error ?? ""));
  // 503 is a feature switched off (no Google or AI key): handled, said plainly to the user
  if (status === 503) {
    log.warn("FEATURE_UNAVAILABLE", { ...base, action, status: "failure", errorCode: "UNAVAILABLE", message: detail || "Feature not configured on this server", attemptedEvent: event });
    return;
  }
  if (status >= 500) {
    log.error("API_OPERATION_FAILED", { ...base, action, status: "failure", errorCode: ERROR_CODES[status] ?? "INTERNAL_ERROR", message: detail || "Server error", failedEvent: event });
    return;
  }
  // "Trip not found." is what a non-member gets for a real trip (requireMember)
  const denied = status === 401 || status === 403 || (status === 404 && tripId !== null && detail === "Trip not found.");
  const isWrite = method !== "GET" && method !== "HEAD";
  // a failed read that isn't about a trip (a stale invite link, an expired
  // session polling) isn't worth a line unless it was a denied write
  if (!route && !isWrite && !denied) return;
  // every signed-out page load asks "who am I?" and is told 401; that's not an attempt
  if (status === 401 && !isWrite && tripId === null) return;
  log.warn(denied && isWrite ? "UNAUTHORIZED_MODIFICATION_ATTEMPT" : denied ? "ACCESS_DENIED" : "INVALID_TRIP_OPERATION", {
    ...base,
    action,
    status: denied ? "denied" : "failure",
    errorCode: ERROR_CODES[status] ?? `HTTP_${status}`,
    message: detail || (status === 401 ? "Not signed in" : `Request refused (${status})`),
    attemptedEvent: event,
  });
}
