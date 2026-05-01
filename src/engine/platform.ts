// Platform abstraction. The engine sees only this; adapters provide it.

import type { Kysely } from "kysely";

export interface Storage {
  put: (key: string, body: Uint8Array | ArrayBuffer, contentType?: string) => Promise<void>;
  get: (key: string) => Promise<Uint8Array | null>;
  delete: (key: string) => Promise<void>;
  /** Optional pre-signed URL helper. Adapters that don't support it return null. */
  signedUrl?: (key: string, ttlSeconds?: number) => Promise<string | null>;
}

export interface Platform<DB = unknown> {
  db: Kysely<DB>;
  storage?: Storage;
  // Future: queue, cache.
}
