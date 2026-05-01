// In-process end-to-end demo. Drizzle owns the schema + migrations; aerie owns
// auth, policies, CRUD routes, and the typed client.
//
// Run with Node 23+ (native TS stripping):
//   node samples/posts/demo.ts
//
// Bun won't work — better-sqlite3 isn't supported in the Bun runtime.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { buildApp } from "../../src/engine/build.ts";
import { nodeSqlitePlatform } from "../../src/adapters/node-sqlite.ts";
import { createClient } from "../../src/client.ts";
import { buildSampleConfig, SECRET, users, type DB } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));

async function sign(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function main() {
  const { platform, raw } = nodeSqlitePlatform<DB>();

  // Apply Drizzle-generated migrations to the same in-memory DB aerie uses.
  const drz = drizzle(raw);
  migrate(drz, { migrationsFolder: join(here, "migrations") });

  // Seed two users via Drizzle (typed insert) so the demo has author rows.
  await drz.insert(users).values([
    { id: "alice", name: "Alice", email: "alice@example.com" },
    { id: "admin1", name: "Admin", email: "admin@example.com" },
  ]);

  const app = buildApp(buildSampleConfig(SECRET), platform);

  const fetchShim: typeof fetch = ((input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    return app.request(url, init);
  }) as typeof fetch;

  const userTok = await sign({ sub: "alice", role: "user" });
  const adminTok = await sign({ sub: "admin1", role: "admin" });

  const alice = createClient<DB>("http://localhost", { token: userTok, fetch: fetchShim });
  const admin = createClient<DB>("http://localhost", { token: adminTok, fetch: fetchShim });

  console.log("→ create post as alice");
  const post = await alice.posts.create({
    title: "Hello aerie",
    body: "Drizzle owns schema, aerie owns auth + CRUD.",
    authorId: "alice",
  });
  console.log("  ", post);

  console.log("→ list posts");
  console.log("  ", await alice.posts.list());

  console.log("→ get post with ?include=author");
  console.log("  ", await alice.posts.get(post.id, { include: ["author"] }));

  console.log("→ alice updates her own post");
  console.log("  ", await alice.posts.update(post.id, { title: "Hello aerie (edited)" }));

  console.log("→ alice tries to delete (forbidden — admin only)");
  try {
    await alice.posts.delete(post.id);
    console.log("   unexpectedly succeeded");
  } catch (e) {
    console.log("  ", (e as Error).message);
  }

  console.log("→ admin deletes");
  await admin.posts.delete(post.id);
  console.log("   gone:", (await alice.posts.get(post.id)) === null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
