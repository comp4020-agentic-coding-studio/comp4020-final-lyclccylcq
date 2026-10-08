import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
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

export function createAuth(db: DatabaseSync, now = () => Date.now()) {
  // Five wrong passwords for one username lock it for ten minutes. In memory
  // is enough on one machine; a restart forgetting it only helps the user.
  const failures = new Map<string, { count: number; until: number }>();

  const toUser = (row: Record<string, unknown>): User => ({
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
  });

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
      const username = str(input.username, "Username", 3, 32);
      if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw bad("Usernames use letters, numbers, dots, dashes and underscores.");
      const password = typeof input.password === "string" ? input.password : "";
      if (password.length < 8 || password.length > 200) throw bad("Passwords need at least 8 characters.");
      const displayName = str(input.displayName ?? username, "Display name", 1, 40);
      if (db.prepare("select 1 from users where username = ?").get(username)) {
        throw new HttpError(409, "That username is taken.");
      }
      const id = randomUUID();
      const hash = await hashPassword(password);
      // the name can be taken while the password hashes
      const r = db
        .prepare("insert into users (id, username, display_name, password_hash, created_at) values (?, ?, ?, ?, ?) on conflict(username) do nothing")
        .run(id, username, displayName, hash, now());
      if (Number(r.changes) !== 1) throw new HttpError(409, "That username is taken.");
      return { user: { id, username, displayName }, token: startSession(id) };
    },

    async login(input: Record<string, unknown>): Promise<{ user: User; token: string }> {
      const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
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
