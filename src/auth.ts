import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { displayNameKey, transaction } from "./db.ts";
import { bad, HttpError } from "./errors.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;
export const COOKIE = "wl_session";

export type User = { id: string; username: string; displayName: string };

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const newToken = (): string => randomBytes(32).toString("base64url");

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== "string") throw bad(`${field} is required.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${field} must be ${min}–${max} characters.`);
  return s;
}

// What people typed, kept as typed apart from outer whitespace (the key used
// for uniqueness is separate). Counted in characters, so 40 Chinese
// characters fit; control and invisible formatting characters are refused.
function displayNameInput(v: unknown): string {
  if (typeof v !== "string") throw new HttpError(400, "Display name is required.", { field: "displayName" });
  const s = v.trim();
  const n = [...s].length;
  if (n < 1 || n > 40) throw new HttpError(400, "Display name must be 1–40 characters.", { field: "displayName" });
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(s)) throw new HttpError(400, "Display names can't contain control or invisible characters.", { field: "displayName" });
  return s;
}

// Usernames are ASCII (letters, digits, . _ -), compared case-insensitively
// everywhere: the column is COLLATE NOCASE, and lookups use this key.
export const usernameKey = (s: string): string => s.trim().toLowerCase();

export const USERNAME_TAKEN = "That username is already taken.";
export const DISPLAY_NAME_TAKEN = "That display name is already taken.";
const taken = (field: "username" | "displayName") =>
  new HttpError(409, field === "username" ? USERNAME_TAKEN : DISPLAY_NAME_TAKEN, { field });

export function createAuth(db: DatabaseSync, now = () => Date.now()) {
  // Five wrong passwords for one username lock it for ten minutes. In memory
  // is enough on one machine; a restart forgetting it only helps the user.
  const failures = new Map<string, { count: number; until: number }>();

  const toUser = (row: Record<string, unknown>): User => ({
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
  });

  const usernameTaken = (username: string): boolean => Boolean(db.prepare("select 1 from users where username = ?").get(usernameKey(username)));
  // Compared in code against every stored name, not only the indexed key:
  // accounts left without a key by a migration collision still count.
  function displayNameTaken(key: string): boolean {
    if (db.prepare("select 1 from users where display_name_key = ?").get(key)) return true;
    for (const r of db.prepare("select display_name from users where display_name_key is null").all()) {
      if (displayNameKey(String(r.display_name)) === key) return true;
    }
    return false;
  }

  // A unique index that refused a write, as the field the person can fix.
  function constraintError(err: unknown): unknown {
    const msg = err instanceof Error ? err.message : "";
    if (!/UNIQUE constraint failed/i.test(msg)) return err;
    if (/users\.username/i.test(msg)) return taken("username");
    if (/display_name_key/i.test(msg)) return taken("displayName");
    return err;
  }

  function startSession(userId: string): string {
    const token = newToken();
    const t = now();
    db.prepare("insert into auth_sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      sha256(token),
      userId,
      t,
      t + SESSION_DAYS * 86_400_000,
    );
    return token;
  }

  return {
    async signup(input: Record<string, unknown>): Promise<{ user: User; token: string }> {
      let username: string;
      try {
        username = str(input.username, "Username", 3, 32);
      } catch (err) {
        throw new HttpError(400, (err as Error).message, { field: "username" });
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw new HttpError(400, "Usernames use letters, numbers, dots, dashes and underscores.", { field: "username" });
      const password = typeof input.password === "string" ? input.password : "";
      if (password.length < 8 || password.length > 200) throw new HttpError(400, "Passwords need at least 8 characters.", { field: "password" });
      const displayName = displayNameInput(input.displayName ?? username);
      const nameKey = displayNameKey(displayName);
      // early answers, before the slow password hash; the insert below is
      // what actually decides, inside one transaction
      if (usernameTaken(username)) throw taken("username");
      if (displayNameTaken(nameKey)) throw taken("displayName");
      const id = randomUUID();
      const hash = await hashPassword(password);
      // Either name can be taken by a concurrent signup while the password
      // hashes. The unique indexes refuse the second insert; the account and
      // its session are created together or not at all.
      try {
        const token = transaction(db, () => {
          if (usernameTaken(username)) throw taken("username");
          if (displayNameTaken(nameKey)) throw taken("displayName");
          db.prepare("insert into users (id, username, display_name, display_name_key, password_hash, created_at) values (?, ?, ?, ?, ?, ?)").run(id, username, displayName, nameKey, hash, now());
          return startSession(id);
        });
        return { user: { id, username, displayName }, token };
      } catch (err) {
        throw constraintError(err);
      }
    },

    // For the sign-up form: is this name free? Advisory only, since the
    // final say is the insert's.
    availability(input: Record<string, unknown>): { username?: boolean; displayName?: boolean } {
      const out: { username?: boolean; displayName?: boolean } = {};
      if (typeof input.username === "string" && input.username.trim()) out.username = !usernameTaken(input.username.trim());
      if (typeof input.displayName === "string" && input.displayName.trim()) out.displayName = !displayNameTaken(displayNameKey(input.displayName));
      return out;
    },

    async login(input: Record<string, unknown>): Promise<{ user: User; token: string }> {
      const username = typeof input.username === "string" ? usernameKey(input.username) : "";
      const password = typeof input.password === "string" ? input.password : "";
      const f = failures.get(username);
      if (f && f.count >= 5 && f.until > now()) {
        throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
      }
      const row = db.prepare("select * from users where username = ?").get(username);
      if (!row || !(await verifyPassword(password, String(row.password_hash)))) {
        const next = f && f.until > now() ? f.count + 1 : 1;
        failures.set(username, { count: next, until: now() + 10 * 60_000 });
        throw new HttpError(401, "Wrong username or password.");
      }
      failures.delete(username);
      return { user: toUser(row), token: startSession(String(row.id)) };
    },

    logout(token: string | undefined): void {
      if (token) db.prepare("delete from auth_sessions where token_hash = ?").run(sha256(token));
    },

    userForToken(token: string | undefined): User | null {
      if (!token) return null;
      const row = db
        .prepare(
          "select u.* from auth_sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?",
        )
        .get(sha256(token), now());
      return row ? toUser(row) : null;
    },
  };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
