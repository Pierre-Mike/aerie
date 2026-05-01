// The single source of truth. Edit this file to change the backend.

import type { Cfg, DbOf } from "./engine/types.ts";
import { health } from "./routes/health.ts";
import { echo } from "./routes/echo.ts";

export function buildConfig(secret: string): Cfg {
  return {
    jwt: { secret, userIdClaim: "sub", roleClaim: "role" },
    entities: {
      users: {
        fields: {
          name: "string",
          email: "string",
        },
        policies: {
          create: { roles: ["admin"] },
          read: "public",
          update: { rule: "row.id == auth.userId" },
          delete: { roles: ["admin"] },
        },
        relations: {
          posts: { kind: "hasMany", target: "posts", fk: "authorId" },
        },
      },
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
        relations: {
          author: { kind: "belongsTo", target: "users", fk: "authorId" },
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
    users: {
      fields: { name: "string", email: "string" },
      policies: {
        create: { roles: ["admin"] },
        read: "public",
        update: { rule: "row.id == auth.userId" },
        delete: { roles: ["admin"] },
      },
    },
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
//   ^? { users: {...}; posts: {...} }
