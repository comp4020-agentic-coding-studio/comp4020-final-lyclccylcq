import { HttpError } from "./errors.ts";

// Who may do what on a trip. Everything that checks a role asks here, so the
// rules live in one place (docs/permissions.md).
//
//   owner         everything
//   collaborator  view, add stops, and change, move or remove the stops they
//                 added themselves; nothing that runs the trip
//   anyone else   nothing: the trip answers 404, as if it didn't exist
export type Role = "owner" | "collaborator";

export type Action =
  | "view"
  | "add_activity"
  | "edit_own_activity"
  | "edit_any_activity"
  | "set_start"
  | "calculate_route"
  | "select_mode"
  | "apply_proposal"
  | "update_trip"
  | "delete_trip"
  | "manage_invites"
  | "manage_requests"
  | "remove_member"
  | "leave"
  | "publish";

const COLLABORATOR: ReadonlySet<Action> = new Set(["view", "add_activity", "edit_own_activity", "calculate_route", "leave"]);

export const can = (role: Role | null, action: Action): boolean =>
  role === "owner" || (role === "collaborator" && COLLABORATOR.has(action));

const OWNER_ONLY: Partial<Record<Action, string>> = {
  delete_trip: "Only the trip's owner can delete it.",
  update_trip: "Only the trip's owner can change the trip's name, dates or settings.",
  manage_invites: "Only the trip's owner can invite people.",
  manage_requests: "Only the trip's owner can approve or reject requests to join.",
  remove_member: "Only the trip's owner can remove people.",
  publish: "Only the trip's owner can publish it.",
  edit_any_activity: "Only the trip's owner can change or remove stops other people added.",
  set_start: "Only the trip's owner can change the starting point.",
  select_mode: "Only the trip's owner can choose how to travel between stops.",
  apply_proposal: "Only the trip's owner can apply schedule fixes.",
};

// Non-members get the same 404 as a trip that doesn't exist; members without
// the right get a 403 that says who can.
export function authorize(role: Role | null, action: Action): Role {
  if (!role) throw new HttpError(404, "Trip not found.");
  if (!can(role, action)) throw new HttpError(403, OWNER_ONLY[action] ?? "You don't have permission to do that.", { code: "forbidden" });
  return role;
}

// A stop: the owner may change any; a collaborator only the ones they added.
export function authorizeActivity(role: Role | null, userId: string, createdBy: string | null): Role {
  const r = authorize(role, "view");
  if (r === "owner" || createdBy === userId) return authorize(r, "edit_own_activity");
  return authorize(r, "edit_any_activity");
}
