// Custom routes (defineRoute / mountRoutes) — auth gating, body validation, public access.

import { describe, it, expect, beforeEach } from "vitest";
import { setup, token, bearer } from "./helpers.ts";

describe("custom routes", () => {
  let app: ReturnType<typeof setup>;
  beforeEach(() => {
    app = setup();
  });

  describe("health (public)", () => {
    it("returns 200 without auth", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; at: string };
      expect(body.status).toBe("ok");
      expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("still returns 200 with a JWT (auth optional on public routes)", async () => {
      const t = await token({ sub: "u1", role: "user" });
      const res = await app.request("/health", { headers: bearer(t) });
      expect(res.status).toBe(200);
    });
  });

  describe("echo (auth-gated, body-validated)", () => {
    it("rejects without auth", async () => {
      const res = await app.request("/echo", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(403);
    });

    it("rejects with wrong role", async () => {
      const t = await token({ sub: "u1", role: "guest" });
      const res = await app.request("/echo", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(403);
    });

    it("rejects bad body shape (400)", async () => {
      const t = await token({ sub: "u1", role: "user" });
      const res = await app.request("/echo", {
        method: "POST",
        body: JSON.stringify({ wrong: "field" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: string };
      expect(err.error).toMatch(/message/);
    });

    it("echoes for valid user with valid body", async () => {
      const t = await token({ sub: "alice", role: "user" });
      const res = await app.request("/echo", {
        method: "POST",
        body: JSON.stringify({ message: "ping" }),
        headers: bearer(t),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { echoed: string; by: string; role: string };
      expect(body).toEqual({ echoed: "ping", by: "alice", role: "user" });
    });
  });

  describe("meta", () => {
    it("root lists custom routes alongside entities", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entities: string[]; routes: string[] };
      expect(body.entities).toContain("posts");
      expect(body.routes).toContain("GET /health");
      expect(body.routes).toContain("POST /echo");
    });
  });
});
