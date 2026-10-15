// Reports accounts whose display names collide under the uniqueness rule
// (src/db.ts displayNameKey), and finishes the migration once none do.
// It never renames, merges or deletes anyone; resolving a collision is a
// person's decision (docs/unique-names.md).
//
//   node scripts/display-names.ts            report, read-only
//   node scripts/display-names.ts --finish   if nothing collides, fill the
//                                            missing keys and add the index
//
// DATA_DIR picks the database, as for the server (/data on Fly).
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { displayNameKey, migrateDisplayNames } from "../src/db.ts";

const file = join(process.env.DATA_DIR ?? "data", "wayline.db");
const finish = process.argv.includes("--finish");
const db = new DatabaseSync(file, { readOnly: !finish });

const cols = db.prepare("pragma table_info(users)").all().map((c) => String(c.name));
const rows = db.prepare("select id, username, display_name, created_at from users order by created_at").all();
const groups = new Map<string, { id: string; username: string; createdAt: number }[]>();
for (const r of rows) {
  const k = displayNameKey(String(r.display_name));
  groups.set(k, [...(groups.get(k) ?? []), { id: String(r.id), username: String(r.username), createdAt: Number(r.created_at) }]);
}
const colliding = [...groups.values()].filter((g) => g.length > 1);
const indexed = Boolean(db.prepare("select 1 from sqlite_master where type = 'index' and name = 'users_display_name_key'").get());

console.log(`${file}: ${rows.length} accounts, ${colliding.length} colliding group(s), unique index ${indexed ? "present" : "not yet created"}${cols.includes("display_name_key") ? "" : " (key column not added yet: the server adds it on start)"}.`);
// usernames and ids only, so the output can be shared to decide what to do
colliding.forEach((g, i) => console.log(`  group ${i + 1}: ${g.map((u) => `@${u.username} (${u.id}, joined ${new Date(u.createdAt).toISOString().slice(0, 10)})`).join(", ")}`));

if (finish) {
  if (colliding.length) {
    console.log("Not finishing: resolve the groups above first (each account in a group needs a different name).");
    process.exitCode = 1;
  } else {
    const { collisions } = migrateDisplayNames(db);
    console.log(collisions ? "Still colliding; nothing changed." : "Done: every account has a key and the unique index exists.");
  }
}
