// Cloudflare Workers entry point.

import { buildApp } from "./engine/build.ts";
import { cloudflarePlatform } from "./adapters/cloudflare.ts";
import { buildConfig, type DB } from "./config.ts";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cfg = buildConfig(env.JWT_SECRET);
    const platform = cloudflarePlatform<DB>(env.DB);
    const app = buildApp(cfg, platform);
    return app.fetch(req);
  },
};
