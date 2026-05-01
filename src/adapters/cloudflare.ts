// Cloudflare Workers adapter. Wraps a D1 binding into a Kysely instance.

import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Platform } from "../engine/platform.ts";

export function cloudflarePlatform<DB>(d1: D1Database): Platform<DB> {
  return {
    db: new Kysely<DB>({ dialect: new D1Dialect({ database: d1 }) }),
  };
}
