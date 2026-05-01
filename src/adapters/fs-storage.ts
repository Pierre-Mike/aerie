// Local filesystem storage adapter. Used by tests and Node deploys.

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Storage } from "../engine/platform.ts";

export function fsStorage(rootDir: string): Storage {
  mkdirSync(rootDir, { recursive: true });
  return {
    async put(key, body) {
      const path = join(rootDir, key);
      mkdirSync(dirname(path), { recursive: true });
      const data =
        body instanceof ArrayBuffer ? new Uint8Array(body) : (body as Uint8Array);
      writeFileSync(path, data);
    },
    async get(key) {
      const path = join(rootDir, key);
      if (!existsSync(path)) return null;
      return new Uint8Array(readFileSync(path));
    },
    async delete(key) {
      const path = join(rootDir, key);
      if (existsSync(path)) unlinkSync(path);
    },
    signedUrl: async (key) => `file://${join(rootDir, key)}`,
  };
}

/** In-memory storage for unit tests — no FS, no cleanup. */
export function memoryStorage(): Storage {
  const store = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      const data =
        body instanceof ArrayBuffer ? new Uint8Array(body) : (body as Uint8Array);
      store.set(key, new Uint8Array(data));
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async delete(key) {
      store.delete(key);
    },
    signedUrl: async (key) => (store.has(key) ? `mem://${key}` : null),
  };
}
