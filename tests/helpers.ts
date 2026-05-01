// Shared test helpers — setup, signing, common users.

import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../src/engine/build.ts";
import { nodeSqlitePlatform } from "../src/adapters/node-sqlite.ts";
import type { Cfg } from "../src/engine/types.ts";
import { buildConfig, type DB } from "../src/config.ts";

export const SECRET = "test-secret-32-bytes-minimum-padding-xx";
const KEY = new TextEncoder().encode(SECRET);

export async function token(p: Record<string, unknown>): Promise<string> {
  return new SignJWT(p)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(KEY);
}

export function bearer(t: string): HeadersInit {
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

const SEED_USER_IDS = ["alice", "bob", "u1", "admin1", "a1"] as const;

/** Build the default app with seeded users. */
export function setup(): ReturnType<typeof buildApp> {
  const { platform, raw } = nodeSqlitePlatform<DB>();
  const sql = readFileSync(join(__dirname, "../migrations/0001_init.sql"), "utf8");
  raw.exec(sql);
  for (const id of SEED_USER_IDS) {
    raw.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(
      id,
      id,
      `${id}@example.com`,
    );
  }
  return buildApp(buildConfig(SECRET), platform);
}

/** Build with a custom config (still seeds users for FK consistency). */
export function setupWith(cfg: Cfg): ReturnType<typeof buildApp> {
  const { platform, raw } = nodeSqlitePlatform();
  const sql = readFileSync(join(__dirname, "../migrations/0001_init.sql"), "utf8");
  raw.exec(sql);
  if (cfg.entities.users) {
    for (const id of SEED_USER_IDS) {
      raw.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(
        id,
        id,
        `${id}@example.com`,
      );
    }
  }
  return buildApp(cfg, platform);
}
