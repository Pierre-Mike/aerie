// Platform abstraction. The engine sees only this; adapters provide it.

import type { Kysely } from "kysely";

export interface Platform<DB = unknown> {
  db: Kysely<DB>;
  // Future: storage, queue, cache. Slice keeps it minimal.
}
