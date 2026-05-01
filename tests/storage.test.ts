// Storage adapter + upload route end-to-end.

import { describe, it, expect } from "vitest";
import { memoryStorage } from "../src/adapters/fs-storage.ts";
import { setup, token, bearer } from "./helpers.ts";

describe("memoryStorage adapter", () => {
  it("put / get / delete round-trip", async () => {
    const s = memoryStorage();
    const data = new TextEncoder().encode("hello world");

    expect(await s.get("a/b")).toBeNull();
    await s.put("a/b", data, "text/plain");
    const fetched = await s.get("a/b");
    expect(fetched).not.toBeNull();
    expect(new TextDecoder().decode(fetched!)).toBe("hello world");

    await s.delete("a/b");
    expect(await s.get("a/b")).toBeNull();
  });

  it("signedUrl returns mem:// for known keys, null for unknown", async () => {
    const s = memoryStorage();
    expect(await s.signedUrl?.("missing")).toBeNull();
    await s.put("found", new Uint8Array([1, 2, 3]));
    expect(await s.signedUrl?.("found")).toBe("mem://found");
  });
});

describe("upload route", () => {
  it("rejects without auth", async () => {
    const app = setup();
    const res = await app.request("/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(403);
  });

  it("stores body and returns key + size + contentType for valid auth", async () => {
    const app = setup();
    const t = await token({ sub: "alice", role: "user" });
    const data = new TextEncoder().encode("file contents");

    const res = await app.request("/upload", {
      method: "POST",
      body: data,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/octet-stream" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; size: number; contentType: string };
    expect(body.key).toMatch(/^alice\/[0-9a-f-]{36}$/);
    expect(body.size).toBe(data.byteLength);
    expect(body.contentType).toBe("application/octet-stream");
  });

  it("rejects empty body with 400", async () => {
    const app = setup();
    const t = await token({ sub: "alice", role: "user" });
    const res = await app.request("/upload", {
      method: "POST",
      body: new Uint8Array(),
      headers: bearer(t),
    });
    expect(res.status).toBe(400);
  });
});
