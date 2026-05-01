// Typed client end-to-end: types derived from DB, hits the engine over a fetch shim.

import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "../src/client.ts";
import type { DB } from "../src/config.ts";
import { setup, token } from "./helpers.ts";

describe("createClient", () => {
  let app: ReturnType<typeof setup>;
  beforeEach(() => {
    app = setup();
  });

  it("CRUD round-trip via typed client", async () => {
    const t = await token({ sub: "alice", role: "user" });
    const adminTok = await token({ sub: "admin1", role: "admin" });

    // fetch shim that proxies to the in-memory Hono app
    const fetchShim: typeof fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      return app.request(url, init);
    }) as typeof fetch;

    const c = createClient<DB>("http://localhost", { token: t, fetch: fetchShim });

    // CREATE — typed body
    const post = await c.posts.create({
      title: "Hello",
      body: "World",
      authorId: "alice",
    });
    expect(post).toMatchObject({ title: "Hello", body: "World", authorId: "alice" });
    expect(post.id).toMatch(/^[0-9a-f-]{36}$/);

    // LIST
    const list = await c.posts.list();
    expect(list).toHaveLength(1);

    // GET
    const fetched = await c.posts.get(post.id);
    expect(fetched?.title).toBe("Hello");

    // UPDATE
    const updated = await c.posts.update(post.id, { title: "Updated" });
    expect(updated.title).toBe("Updated");

    // DELETE — needs admin
    const adminClient = createClient<DB>("http://localhost", { token: adminTok, fetch: fetchShim });
    await adminClient.posts.delete(post.id);
    expect(await c.posts.get(post.id)).toBeNull();
  });

  it("client.users.list returns seeded users", async () => {
    const fetchShim: typeof fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      return app.request(url, init);
    }) as typeof fetch;

    const c = createClient<DB>("http://localhost", { fetch: fetchShim });
    const users = await c.users.list();
    expect(users.map((u) => u.id).sort()).toEqual(["a1", "admin1", "alice", "bob", "u1"]);
  });

  it("supports ?include via opts", async () => {
    const t = await token({ sub: "alice", role: "user" });
    const fetchShim: typeof fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      return app.request(url, init);
    }) as typeof fetch;

    const c = createClient<DB>("http://localhost", { token: t, fetch: fetchShim });
    const post = await c.posts.create({ title: "T", body: "B", authorId: "alice" });

    const expanded = (await c.posts.get(post.id, { include: ["author"] })) as
      | (typeof post & { author: { id: string; name: string } })
      | null;
    expect(expanded?.author?.id).toBe("alice");
  });

  it("returns null on 404 (not throw)", async () => {
    const fetchShim: typeof fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      return app.request(url, init);
    }) as typeof fetch;

    const c = createClient<DB>("http://localhost", { fetch: fetchShim });
    expect(await c.posts.get("nonexistent")).toBeNull();
  });
});
