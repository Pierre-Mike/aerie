// Lifecycle hooks: beforeCreate mutation, afterCreate observation,
// beforeUpdate / afterUpdate, beforeDelete / afterDelete.

import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../src/engine/build.ts";
import { nodeSqlitePlatform } from "../src/adapters/node-sqlite.ts";
import type { Cfg } from "../src/engine/types.ts";

const SECRET = "test-secret-32-bytes-minimum-padding-xx";
const KEY = new TextEncoder().encode(SECRET);

async function token(p: Record<string, unknown>): Promise<string> {
  return new SignJWT(p).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(KEY);
}

function setup(cfg: Cfg) {
  const { platform, raw } = nodeSqlitePlatform();
  const sql = readFileSync(join(__dirname, "../migrations/0001_init.sql"), "utf8");
  raw.exec(sql);
  return buildApp(cfg, platform);
}

describe("entity hooks", () => {
  it("beforeCreate can mutate the row (auto-fill authorId from auth)", async () => {
    const events: string[] = [];
    const cfg: Cfg = {
      jwt: { secret: SECRET },
      entities: {
        posts: {
          fields: {
            title: "string",
            body: "string",
            authorId: { type: "string", required: false },
          },
          policies: {
            create: { roles: ["user"] },
            read: "public",
            update: { rule: "row.authorId == auth.userId" },
            delete: { roles: ["admin"] },
          },
          hooks: {
            beforeCreate: (row, ctx) => ({ ...row, authorId: ctx.auth?.userId ?? "anon" }),
            afterCreate: (row) => { events.push(`created:${row.id}`); },
          },
        },
      },
    };
    const app = setup(cfg);
    const t = await token({ sub: "alice", role: "user" });
    const res = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B" }), // note: no authorId sent
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as { authorId: string; id: string };
    expect(post.authorId).toBe("alice");
    expect(events).toEqual([`created:${post.id}`]);
  });

  it("beforeUpdate observes prev row and can sanitize patch", async () => {
    const cfg: Cfg = {
      jwt: { secret: SECRET },
      entities: {
        posts: {
          fields: {
            title: "string",
            body: "string",
            authorId: "string",
          },
          policies: {
            create: { roles: ["user"] },
            read: "public",
            update: { rule: "row.authorId == auth.userId" },
            delete: { roles: ["admin"] },
          },
          hooks: {
            // Force title to uppercase on every update.
            beforeUpdate: (patch, _prev) => ({
              ...patch,
              ...(typeof patch.title === "string" ? { title: patch.title.toUpperCase() } : {}),
            }),
          },
        },
      },
    };
    const app = setup(cfg);
    const t = await token({ sub: "alice", role: "user" });
    const headers = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };

    const created = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "hello", body: "B", authorId: "alice" }),
      headers,
    });
    const post = (await created.json()) as { id: string };

    const updated = await app.request(`/api/posts/${post.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "lowercase" }),
      headers,
    });
    expect(updated.status).toBe(200);
    const result = (await updated.json()) as { title: string };
    expect(result.title).toBe("LOWERCASE");
  });

  it("beforeDelete + afterDelete fire in order with the row", async () => {
    const events: string[] = [];
    const cfg: Cfg = {
      jwt: { secret: SECRET },
      entities: {
        posts: {
          fields: { title: "string", body: "string", authorId: "string" },
          policies: {
            create: { roles: ["user", "admin"] },
            read: "public",
            update: { rule: "row.authorId == auth.userId" },
            delete: { roles: ["admin"] },
          },
          hooks: {
            beforeDelete: (row) => { events.push(`before:${(row as { title: string }).title}`); },
            afterDelete:  (row) => { events.push(`after:${(row as { title: string }).title}`); },
          },
        },
      },
    };
    const app = setup(cfg);
    const userTok = await token({ sub: "u1", role: "user" });
    const adminTok = await token({ sub: "a1", role: "admin" });

    const c = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "doomed", body: "B", authorId: "u1" }),
      headers: { Authorization: `Bearer ${userTok}`, "Content-Type": "application/json" },
    });
    const post = (await c.json()) as { id: string };

    const d = await app.request(`/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminTok}` },
    });
    expect(d.status).toBe(204);
    expect(events).toEqual(["before:doomed", "after:doomed"]);
  });
});
