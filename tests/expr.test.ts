// Expression evaluator + complex policy rules.

import { describe, it, expect } from "vitest";
import { compile } from "../src/engine/expr.ts";
import { setupWith, token, SECRET } from "./helpers.ts";
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
    expect(() => compile("row.n + 1")).not.toThrow();
    expect(() => compile("row.n + 1")({ row: { n: 1 }, auth: {} })).toThrow(/disallowed/);
  });

  it("missing scope key yields undefined, not crash", () => {
    expect(compile("row.x == auth.userId")({ row: {}, auth: {} })).toBe(true);
    expect(compile("auth.foo.bar == 1")({ row: {}, auth: {} })).toBe(false);
  });
});

describe("policy with arbitrary rule", () => {
  const cfg: Cfg = {
    jwt: { secret: SECRET },
    entities: {
      users: {
        fields: { name: "string", email: "string" },
        policies: {
          create: { roles: ["admin"] },
          read: "public",
          update: "public",
          delete: { roles: ["admin"] },
        },
      },
      posts: {
        fields: { title: "string", body: "string", authorId: "string" },
        policies: {
          create: { roles: ["user", "admin"] },
          read: { rule: "row.authorId == auth.userId || auth.role == 'admin'" },
          update: { rule: "row.authorId == auth.userId" },
          delete: { roles: ["admin"] },
        },
        relations: { author: { kind: "belongsTo", target: "users", fk: "authorId" } },
      },
    },
  };

  it("LIST filters rows post-fetch by predicate", async () => {
    const app = setupWith(cfg);
    const aliceTok = await token({ sub: "alice", role: "user" });
    const bobTok = await token({ sub: "bob", role: "user" });
    const adminTok = await token({ sub: "admin1", role: "admin" });

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
    expect(adminRows).toHaveLength(2);
  });

  it("GET enforces rule on individual row", async () => {
    const app = setupWith(cfg);
    const aliceTok = await token({ sub: "alice", role: "user" });
    const bobTok = await token({ sub: "bob", role: "user" });

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
