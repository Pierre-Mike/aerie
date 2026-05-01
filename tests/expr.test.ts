// Expression evaluator + complex policy rules.

import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "../src/engine/expr.ts";
import { buildApp } from "../src/engine/build.ts";
import { nodeSqlitePlatform } from "../src/adapters/node-sqlite.ts";
import type { Cfg } from "../src/engine/types.ts";

describe("expr.compile", () => {
  it("supports == === != !== < <= > >= && || ! and member access", () => {
    expect(compile("row.x == auth.userId")({ row: { x: "a" }, auth: { userId: "a" } })).toBe(true);
    expect(compile("row.x == auth.userId")({ row: { x: "a" }, auth: { userId: "b" } })).toBe(false);
    expect(compile("row.n > 5 && row.n < 10")({ row: { n: 7 }, auth: {} })).toBe(true);
    expect(compile("row.n > 5 && row.n < 10")({ row: { n: 4 }, auth: {} })).toBe(false);
    expect(compile("auth.role == 'admin' || row.public")(
      { row: { public: false }, auth: { role: "admin" } },
    )).toBe(true);
    expect(compile("!row.deleted")({ row: { deleted: true }, auth: {} })).toBe(false);
    expect(compile("row.a.b.c == 42")({ row: { a: { b: { c: 42 } } }, auth: {} })).toBe(true);
  });

  it("rejects disallowed operators", () => {
    expect(() => compile("row.n + 1")).not.toThrow(); // parse OK
    expect(() => compile("row.n + 1")({ row: { n: 1 }, auth: {} })).toThrow(/disallowed/);
  });

  it("missing scope key yields undefined, not crash", () => {
    expect(compile("row.x == auth.userId")({ row: {}, auth: {} })).toBe(true); // undefined === undefined
    expect(compile("auth.foo.bar == 1")({ row: {}, auth: {} })).toBe(false);
  });
});

describe("policy with arbitrary rule", () => {
  const SECRET = "test-secret-32-bytes-minimum-padding-xx";
  const KEY = new TextEncoder().encode(SECRET);
  const tok = (p: Record<string, unknown>) =>
    new SignJWT(p).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(KEY);

  function setup(cfg: Cfg) {
    const { platform, raw } = nodeSqlitePlatform();
    const sql = readFileSync(join(__dirname, "../migrations/0001_init.sql"), "utf8");
    raw.exec(sql);
    return buildApp(cfg, platform);
  }

  const cfg: Cfg = {
    jwt: { secret: SECRET },
    entities: {
      posts: {
        fields: { title: "string", body: "string", authorId: "string" },
        policies: {
          create: { roles: ["user", "admin"] },
          // Owner OR admin can read; LIST filters in memory.
          read: { rule: "row.authorId == auth.userId || auth.role == 'admin'" },
          update: { rule: "row.authorId == auth.userId" },
          delete: { roles: ["admin"] },
        },
      },
    },
  };

  it("LIST filters rows post-fetch by predicate", async () => {
    const app = setup(cfg);
    const aliceTok = await tok({ sub: "alice", role: "user" });
    const bobTok = await tok({ sub: "bob", role: "user" });
    const adminTok = await tok({ sub: "admin1", role: "admin" });

    const headers = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

    await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "alice-1", body: "x", authorId: "alice" }),
      headers: headers(aliceTok),
    });
    await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "bob-1", body: "x", authorId: "bob" }),
      headers: headers(bobTok),
    });

    const aliceList = await app.request("/api/posts", { headers: headers(aliceTok) });
    const aliceRows = (await aliceList.json()) as { authorId: string }[];
    expect(aliceRows.map((r) => r.authorId)).toEqual(["alice"]);

    const adminList = await app.request("/api/posts", { headers: headers(adminTok) });
    const adminRows = (await adminList.json()) as unknown[];
    expect(adminRows).toHaveLength(2); // admin sees all
  });

  it("GET enforces rule on individual row", async () => {
    const app = setup(cfg);
    const aliceTok = await tok({ sub: "alice", role: "user" });
    const bobTok = await tok({ sub: "bob", role: "user" });

    const created = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "private", body: "x", authorId: "alice" }),
      headers: { Authorization: `Bearer ${aliceTok}`, "Content-Type": "application/json" },
    });
    const post = (await created.json()) as { id: string };

    const aliceGet = await app.request(`/api/posts/${post.id}`, {
      headers: { Authorization: `Bearer ${aliceTok}` },
    });
    expect(aliceGet.status).toBe(200);

    const bobGet = await app.request(`/api/posts/${post.id}`, {
      headers: { Authorization: `Bearer ${bobTok}` },
    });
    expect(bobGet.status).toBe(403);
  });
});
