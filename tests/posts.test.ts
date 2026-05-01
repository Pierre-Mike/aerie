// End-to-end integration test: in-memory SQLite + real engine + signed JWTs.
// Tests the validating slice: role-gated create/delete, public read, row-rule update.

import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../src/engine/build.ts";
import { nodeSqlitePlatform } from "../src/adapters/node-sqlite.ts";
import { buildConfig, type DB } from "../src/config.ts";

const SECRET = "test-secret-32-bytes-minimum-padding-xx";
const KEY = new TextEncoder().encode(SECRET);

async function token(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(KEY);
}

function bearer(t: string): HeadersInit {
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

function setup() {
  const { platform, raw } = nodeSqlitePlatform<DB>();
  const sql = readFileSync(join(__dirname, "../migrations/0001_init.sql"), "utf8");
  raw.exec(sql);
  const cfg = buildConfig(SECRET);
  const app = buildApp(cfg, platform);
  return { app, raw };
}

describe("posts entity", () => {
  let app: ReturnType<typeof setup>["app"];

  beforeEach(() => {
    app = setup().app;
  });

  describe("policies — deny by default", () => {
    it("rejects create without auth", async () => {
      const res = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "x", body: "y", authorId: "u1" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(403);
    });

    it("rejects create with unknown role", async () => {
      const t = await token({ sub: "u1", role: "guest" });
      const res = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "x", body: "y", authorId: "u1" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(403);
    });

    it("rejects create with no role claim", async () => {
      const t = await token({ sub: "u1" });
      const res = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "x", body: "y", authorId: "u1" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(403);
    });

    it("rejects create with forged JWT", async () => {
      const t = await new SignJWT({ sub: "u1", role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode("wrong-secret-padding-padding-pad"));
      const res = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "x", body: "y", authorId: "u1" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("CRUD with valid auth", () => {
    it("creates a post as user, reads it publicly, lets owner update, blocks other update", async () => {
      const alice = await token({ sub: "alice", role: "user" });
      const bob = await token({ sub: "bob", role: "user" });

      // CREATE — alice
      const create = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "Hello", body: "World", authorId: "alice" }),
        headers: bearer(alice),
      });
      expect(create.status).toBe(201);
      const post = (await create.json()) as { id: string; title: string };
      expect(post.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(post.title).toBe("Hello");

      // LIST — public
      const list = await app.request("/api/posts");
      expect(list.status).toBe(200);
      const rows = (await list.json()) as unknown[];
      expect(rows).toHaveLength(1);

      // GET by id — public
      const get = await app.request(`/api/posts/${post.id}`);
      expect(get.status).toBe(200);

      // UPDATE — alice (owner) → allowed
      const okUpdate = await app.request(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Updated" }),
        headers: bearer(alice),
      });
      expect(okUpdate.status).toBe(200);
      const updated = (await okUpdate.json()) as { title: string };
      expect(updated.title).toBe("Updated");

      // UPDATE — bob (not owner) → forbidden
      const blockedUpdate = await app.request(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Hijacked" }),
        headers: bearer(bob),
      });
      expect(blockedUpdate.status).toBe(403);

      // DELETE — user role → forbidden (only admin)
      const userDelete = await app.request(`/api/posts/${post.id}`, {
        method: "DELETE",
        headers: bearer(alice),
      });
      expect(userDelete.status).toBe(403);

      // DELETE — admin → allowed
      const admin = await token({ sub: "admin1", role: "admin" });
      const adminDelete = await app.request(`/api/posts/${post.id}`, {
        method: "DELETE",
        headers: bearer(admin),
      });
      expect(adminDelete.status).toBe(204);

      // GET after delete → 404
      const gone = await app.request(`/api/posts/${post.id}`);
      expect(gone.status).toBe(404);
    });
  });

  describe("validation", () => {
    it("rejects missing required field", async () => {
      const t = await token({ sub: "u1", role: "user" });
      const res = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "x", authorId: "u1" }), // missing body
        headers: bearer(t),
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: string };
      expect(err.error).toMatch(/body/);
    });

    it("rejects wrong field type", async () => {
      const t = await token({ sub: "u1", role: "user" });
      const res = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: 123, body: "y", authorId: "u1" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(400);
    });

    it("strips id from update payloads", async () => {
      const alice = await token({ sub: "alice", role: "user" });
      const create = await app.request("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "T", body: "B", authorId: "alice" }),
        headers: bearer(alice),
      });
      const post = (await create.json()) as { id: string };

      const update = await app.request(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ id: "tampered", title: "New" }),
        headers: bearer(alice),
      });
      expect(update.status).toBe(200);
      const result = (await update.json()) as { id: string; title: string };
      expect(result.id).toBe(post.id);
      expect(result.title).toBe("New");
    });
  });

  describe("meta", () => {
    it("root returns entity list", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entities: string[] };
      expect(body.entities).toContain("posts");
    });
  });
});
