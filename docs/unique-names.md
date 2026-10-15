# Unique display names: migration notes

Usernames were already unique (`users.username`, `COLLATE NOCASE`, ASCII
only). From October 2026 display names are unique too.

## The comparison key

`displayNameKey` in `src/db.ts`:

1. Unicode NFKC, so full-width and compatibility forms match their plain
   forms (`Ａｎｎａ` is `Anna`).
2. Outer whitespace trimmed.
3. Runs of inner whitespace collapsed to one space. Inner spaces are kept,
   not removed: `Ann Lee` and `AnnLee` are different names, and so are
   `陈 小明` and `陈小明`.
4. Lower-cased with Unicode rules (`toLocaleLowerCase("und")`), so `Äsa`
   and `äSA` match. Scripts without case, Chinese for example, are compared
   as typed.

The name people see is stored as typed, trimmed, in `display_name`. The key
goes in `display_name_key`, with a unique index (`users_display_name_key`).
SQLite's `NOCASE` folds only ASCII, so the key is computed in code. Control
and invisible formatting characters (such as zero-width spaces) are refused
in new names, because they would allow look-alikes.

## What happens to existing accounts

On start, `migrateDisplayNames` adds the column if it's missing and fills the
key for every account.

- **No collisions:** the unique index is created and the migration is done.
- **Collisions:** accounts that share a key keep their names unchanged and get
  a null key. The index is not created, and the server logs only the number of
  groups and accounts. Nobody is renamed, merged or deleted. Sign-up still
  refuses any new name that matches an existing one, including the colliding
  ones: the code compares against every stored name, and sign-ups are
  serialised in a write transaction.

## Resolving collisions

```
DATA_DIR=/data node scripts/display-names.ts           # report (read-only)
DATA_DIR=/data node scripts/display-names.ts --finish  # once resolved: add the index
```

The report lists each group by username, id and join date, without display
names. Deciding which account changes its name is a person's decision.
Wayline has no rename feature yet, so a change is made by an operator with
the account holder's agreement. After that, `--finish` or a restart creates
the index.

Production was not inspected when this was written. Run the report there
before deploying to see whether any groups exist.
