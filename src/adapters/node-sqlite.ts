// Node/Bun adapter using better-sqlite3. Used by tests and local dev outside Workers.

import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Platform, Storage } from "../engine/platform.ts";
import { memoryStorage } from "./fs-storage.ts";

export function nodeSqlitePlatform<DB>(
  file: string | ":memory:" = ":memory:",
  storage: Storage = memoryStorage(),
): {
  platform: Platform<DB>;
  raw: Database.Database;
} {
  const raw = new Database(file === ":memory:" ? ":memory:" : file);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: raw }) });
  return { platform: { db, storage }, raw };
}
