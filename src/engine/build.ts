// Compose engine pieces into a Hono app. Add custom routes after.

import { Hono } from "hono";
import type { Cfg, Vars } from "./types.ts";
import type { Platform } from "./platform.ts";
import { authMiddleware } from "./auth.ts";
import { mountCrud } from "./crud.ts";

export type App = Hono<{ Variables: Vars }>;

export function buildApp<DB>(cfg: Cfg, platform: Platform<DB>): App {
  const app = new Hono<{ Variables: Vars }>();
  app.use("/api/*", authMiddleware(cfg));
  mountCrud(app, cfg, platform.db);
  app.get("/", (c) =>
    c.json({ name: "aerie", entities: Object.keys(cfg.entities) }),
  );
  return app;
}
