// One file: Drizzle schema + aerie policies/relations side by side.
// Edit this, run `drizzle-kit generate` to emit migrations, restart.

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { InferSelectModel } from "drizzle-orm";
import type { Cfg } from "../../src/engine/types.ts";
import { fieldsFrom } from "../../src/engine/drizzle.ts";

// ── schema (Drizzle owns columns + migrations) ────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
});

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: text("authorId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

// ── policies / relations (aerie owns auth + CRUD shape) ───────────────────────
export function buildSampleConfig(secret: string): Cfg {
  return {
    jwt: { secret, userIdClaim: "sub", roleClaim: "role" },
    entities: {
      users: {
        fields: fieldsFrom(users),
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
        fields: fieldsFrom(posts),
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
  };
}

// Row types come straight from Drizzle — no parallel TS schema to maintain.
export type DB = {
  users: InferSelectModel<typeof users>;
  posts: InferSelectModel<typeof posts>;
};

export const SECRET = "sample-secret-32-bytes-minimum-padding-x";
