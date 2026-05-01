// Compose engine pieces into a Hono app. Add custom routes after.

import { Hono } from "hono";
import type { Cfg, Vars } from "./types.ts";
import type { Platform } from "./platform.ts";
import { authMiddleware } from "./auth.ts";
import { mountCrud } from "./crud.ts";
import { mountRoutes } from "./route.ts";

export type App = Hono<{ Variables: Vars }>;

export function buildApp<DB>(cfg: Cfg, platform: Platform<DB>): App {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", authMiddleware(cfg));
  mountCrud(app, cfg, platform.db);
  if (cfg.routes) {
    mountRoutes(app, cfg.routes, {
      db: platform.db,
      storage: platform.storage,
    });
  }
  app.get("/", (c) =>
    c.json({
      name: "aerie",
      entities: Object.keys(cfg.entities),
      routes: (cfg.routes ?? []).map((r) => `${r.method} ${r.path}`),
    }),
  );
  return app;
}
