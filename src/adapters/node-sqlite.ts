// Node/Bun adapter using better-sqlite3. Used by tests and local dev outside Workers.

import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Platform } from "../engine/platform.ts";

export function nodeSqlitePlatform<DB>(file: string | ":memory:" = ":memory:"): {
  platform: Platform<DB>;
  raw: Database.Database;
} {
  const raw = new Database(file === ":memory:" ? ":memory:" : file);
  raw.pragma("journal_mode = WAL");
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: raw }) });
  return { platform: { db }, raw };
}
