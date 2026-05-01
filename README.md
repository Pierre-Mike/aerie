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
- **Tiny** — ~400 LOC of engine. Read it in an afternoon. Own it.

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

## Status

Validating slice. Posts entity, role + row-level policies, JWT verify, integration tests green. Not production-ready.

## License

MIT.
