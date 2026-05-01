# aerie

One config file → typed CRUD + auth, on Cloudflare Workers (or anywhere).

```ts
// src/config.ts — your whole backend
export default {
  jwt: { secret: env.JWT_SECRET, userIdClaim: "sub", roleClaim: "role" },
  entities: {
    posts: {
      fields: { title: "string", body: "string", authorId: "string" },
      policies: {
        create: { roles: ["user", "admin"] },
        read:   "public",
        update: { rule: "row.authorId == auth.userId" },
        delete: { roles: ["admin"] },
      },
    },
  },
} satisfies Cfg;
```

That's it. CRUD routes, role checks, row-level filters, and end-to-end TS types are all derived from this file.

## Why

80% of apps are auth + CRUD. Building it should be one file.

- **One source of truth** — entities, fields, policies, validation in `config.ts`. Add a field once.
- **End-to-end types** — config flows into Kysely, Hono routes, and the RPC client. No codegen.
- **External auth** — bring any IdP that issues a JWT (Clerk, Auth0, WorkOS, Better-Auth, Supabase). Aerie verifies and reads claims; never owns identity.
- **Cloudflare-first, not Cloudflare-only** — D1 + R2 + KV out of the box; `Platform` adapter swaps to Postgres/S3/Redis on Node, AWS, Bun.
- **Local-first** — `wrangler dev` gives you the full stack against local D1. Tests run via Vitest with in-memory SQLite.
- **Tiny** — ~600 LOC of engine + sample. Read it in an afternoon. Own it.

## Quick start

```bash
bun install
bun test                    # vitest, in-memory SQLite, no infra needed
bun run migrate:local       # apply migrations to local D1
bun run dev                 # wrangler dev → http://localhost:8787
```

## Custom routes

CRUD lives in `config.ts`. Anything else is one function per file, registered in the same config:

```ts
// src/routes/checkout.ts
import { defineRoute } from "../engine/route.ts";
export const checkout = defineRoute({
  method: "POST",
  path: "/checkout",
  auth: { roles: ["user", "admin"] },   // same Policy DSL as entities
  body: CheckoutBody,                    // any { parse(unknown) => T } — Zod, Valibot, hand-rolled
  handler: ({ auth, body }) => {
    /* ... */
    return { url };
  },
});

// src/config.ts
import { checkout } from "./routes/checkout.ts";
export const cfg = { entities: { /* ... */ }, routes: [checkout] };
```

One file, one route, fully typed. JWT verified by the same middleware. The config still lists every endpoint in the app.

## Typed client

```ts
import { createClient } from "aerie/client";
import type { DB } from "./config";

const c = createClient<DB>("https://api.example.com", { token: clerkJwt });

const post = await c.posts.create({ title: "hi", body: "x", authorId: "alice" });
//    ^? typed return — { id, title, body, authorId }
const list = await c.posts.list();
const expanded = await c.posts.get(post.id, { include: ["author"] });
await c.posts.update(post.id, { title: "edited" });
```

Types derive from your config. No codegen, no separate schema.

## Schema & migrations (optional: Drizzle)

For real migrations, point Drizzle at your config and let aerie infer fields from the same tables:

```ts
// config.ts — schema + policies in one file
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { fieldsFrom } from "aerie/drizzle";

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: text("authorId").notNull().references(() => users.id),
});

export const cfg = {
  entities: {
    posts: {
      fields: fieldsFrom(posts),                    // ← derived, not duplicated
      policies: { /* ... */ },
      relations: { /* ... */ },
    },
  },
};
```

```bash
bunx drizzle-kit generate    # emits SQL migration
bunx drizzle-kit push        # applies to D1 / SQLite / Postgres
```

Drizzle owns columns + migrations. Aerie owns auth, policies, CRUD, hooks, relations, the typed client. Same approach works against any Drizzle-supported DB. End-to-end runnable example in [`samples/posts/`](./samples/posts/).

## Status

39/39 tests green. Working today:

- Entities — fields (string/int/bool/datetime/file), policies (public / authenticated / roles / arbitrary expression rules via jsep), validation
- Relations — `belongsTo` (FK validation on write) + `hasMany` (`?include=` expansion on read)
- Lifecycle hooks — beforeCreate / afterCreate / beforeUpdate / afterUpdate / beforeDelete / afterDelete
- Custom routes via `defineRoute` (one file per handler), composed in `cfg.routes`
- JWT verify — HS256 shared secret or remote JWKS (Clerk / Auth0 / Better-Auth)
- Storage — Platform.storage (R2 on CF, FS / memory on Node) + sample upload route
- Typed client — `createClient<DB>()` derives shapes from the config
- D1 adapter (Workers) + better-sqlite3 adapter (tests / local Node)
- Drizzle bridge — `fieldsFrom(table)` derives aerie fields from a Drizzle schema; migrations via `drizzle-kit`

Not production-ready. Known gaps: computed fields (function-based read-only columns), OpenAPI export, multi-tenant patterns, soft-delete sugar, Postgres/MySQL platform adapters (Kysely supports them — just need wiring).

## License

MIT.
