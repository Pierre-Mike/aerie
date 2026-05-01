// Cloudflare Workers adapter. Wraps a D1 binding (and optional R2) into a Platform.

import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Platform, Storage } from "../engine/platform.ts";

export function cloudflarePlatform<DB>(d1: D1Database, r2?: R2Bucket): Platform<DB> {
  return {
    db: new Kysely<DB>({ dialect: new D1Dialect({ database: d1 }) }),
    storage: r2 ? r2Storage(r2) : undefined,
  };
}

function r2Storage(r2: R2Bucket): Storage {
  return {
    async put(key, body, contentType) {
      const data = body instanceof ArrayBuffer ? body : (body as Uint8Array);
      await r2.put(key, data, contentType ? { httpMetadata: { contentType } } : undefined);
    },
    async get(key) {
      const obj = await r2.get(key);
      if (!obj) return null;
      return new Uint8Array(await obj.arrayBuffer());
    },
    async delete(key) {
      await r2.delete(key);
    },
    // R2 signed URLs require explicit setup (signed URL service or Workers AI gateway).
    signedUrl: undefined,
  };
}
