// Relations: belongsTo + hasMany, FK validation on writes, ?include= expansion.

import { describe, it, expect, beforeEach } from "vitest";
import { setup, token, bearer } from "./helpers.ts";

describe("relations", () => {
  let app: ReturnType<typeof setup>;
  beforeEach(() => {
    app = setup();
  });

  it("rejects create with FK referencing nonexistent user", async () => {
    const t = await token({ sub: "alice", role: "user" });
    const res = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "X", body: "Y", authorId: "ghost" }),
      headers: bearer(t),
    });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string };
    expect(err.error).toMatch(/users with id 'ghost' not found/);
  });

  it("accepts create with valid FK", async () => {
    const t = await token({ sub: "alice", role: "user" });
    const res = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "X", body: "Y", authorId: "alice" }),
      headers: bearer(t),
    });
    expect(res.status).toBe(201);
  });

  it("rejects update that swaps FK to a nonexistent target", async () => {
    const t = await token({ sub: "alice", role: "user" });
    const create = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "X", body: "Y", authorId: "alice" }),
      headers: bearer(t),
    });
    const post = (await create.json()) as { id: string };

    const update = await app.request(`/api/posts/${post.id}`, {
      method: "PATCH",
      body: JSON.stringify({ authorId: "ghost" }),
      headers: bearer(t),
    });
    expect(update.status).toBe(400);
  });

  it("?include=author expands belongsTo on GET", async () => {
    const t = await token({ sub: "alice", role: "user" });
    const create = await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "X", body: "Y", authorId: "alice" }),
      headers: bearer(t),
    });
    const post = (await create.json()) as { id: string };

    const res = await app.request(`/api/posts/${post.id}?include=author`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { author: { id: string; name: string } };
    expect(body.author).toMatchObject({ id: "alice", name: "alice" });
  });

  it("?include=posts expands hasMany on GET user", async () => {
    const t = await token({ sub: "alice", role: "user" });
    await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "P1", body: "B", authorId: "alice" }),
      headers: bearer(t),
    });
    await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "P2", body: "B", authorId: "alice" }),
      headers: bearer(t),
    });

    const res = await app.request("/api/users/alice?include=posts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { title: string }[] };
    expect(body.posts).toHaveLength(2);
    expect(body.posts.map((p) => p.title).sort()).toEqual(["P1", "P2"]);
  });

  it("?include=author works on LIST", async () => {
    const t = await token({ sub: "alice", role: "user" });
    await app.request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: "P", body: "B", authorId: "alice" }),
      headers: bearer(t),
    });

    const res = await app.request("/api/posts?include=author");
    const rows = (await res.json()) as { author: { name: string } }[];
    expect(rows[0]?.author?.name).toBe("alice");
  });
});
