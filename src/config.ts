// The single source of truth. Edit this file to change the backend.

import type { Cfg, DbOf } from "./engine/types.ts";
import { health } from "./routes/health.ts";
import { echo } from "./routes/echo.ts";

export function buildConfig(secret: string): Cfg {
  return {
    jwt: { secret, userIdClaim: "sub", roleClaim: "role" },
    entities: {
      posts: {
        fields: {
          title: "string",
          body: "string",
          authorId: "string",
        },
        policies: {
          create: { roles: ["user", "admin"] },
          read: "public",
          update: { rule: "row.authorId == auth.userId" },
          delete: { roles: ["admin"] },
        },
      },
    },
    routes: [health, echo],
  };
}

// Const config used purely for type derivation. Value is irrelevant for types.
const sampleConfig = {
  jwt: { secret: "" } as const,
  entities: {
    posts: {
      fields: {
        title: "string",
        body: "string",
        authorId: "string",
      },
      policies: {
        create: { roles: ["user", "admin"] },
        read: "public",
        update: { rule: "row.authorId == auth.userId" },
        delete: { roles: ["admin"] },
      },
    },
  },
} as const satisfies Cfg;

export type AppConfig = typeof sampleConfig;
export type DB = DbOf<AppConfig>;
//   ^? { posts: { id: string; title: string; body: string; authorId: string } }
