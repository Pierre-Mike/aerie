// Typed RPC-style client. Types derive from `DB` (the config-derived row map),
// not from Hono's runtime app — same end-to-end safety, works through our
// mutation-based mounting.
//
// Example:
//   import type { DB } from "./config.ts";
//   const c = createClient<DB>("http://localhost:8787", { token });
//   const post = await c.posts.create({ title: "hi", body: "x", authorId: "alice" });
//                                       // ^ typed body, typed return

export type EntityClient<R extends Record<string, unknown>> = {
  list: (opts?: { include?: string[] }) => Promise<R[]>;
  get: (id: string, opts?: { include?: string[] }) => Promise<R | null>;
  create: (body: Omit<R, "id">) => Promise<R>;
  update: (id: string, patch: Partial<Omit<R, "id">>) => Promise<R>;
  delete: (id: string) => Promise<void>;
};

export type Client<DB> = {
  [K in keyof DB & string]: DB[K] extends Record<string, unknown> ? EntityClient<DB[K]> : never;
};

export type ClientOpts = {
  token?: string;
  /** Override fetch (for tests; defaults to globalThis.fetch). */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export function createClient<DB>(baseUrl: string, opts: ClientOpts = {}): Client<DB> {
  type FetchFn = NonNullable<ClientOpts["fetch"]>;
  const f: FetchFn = opts.fetch ?? ((u, i) => fetch(u as RequestInfo, i));
  const headers = (extra: HeadersInit = {}): HeadersInit => ({
    "Content-Type": "application/json",
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...extra,
  });

  function urlFor(name: string, path: string, q?: { include?: string[] }): string {
    const u = new URL(`/api/${name}${path}`, baseUrl);
    if (q?.include?.length) u.searchParams.set("include", q.include.join(","));
    return u.toString();
  }

  function entity(name: string): EntityClient<Record<string, unknown>> {
    return {
      list: async (q) => {
        const res = await f(urlFor(name, "", q), { headers: headers() });
        if (!res.ok) throw new Error(`list ${name} failed: ${res.status}`);
        return (await res.json()) as Record<string, unknown>[];
      },
      get: async (id, q) => {
        const res = await f(urlFor(name, `/${id}`, q), { headers: headers() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`get ${name}/${id} failed: ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      create: async (body) => {
        const res = await f(urlFor(name, ""), {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`create ${name} failed: ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      update: async (id, patch) => {
        const res = await f(urlFor(name, `/${id}`), {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`update ${name}/${id} failed: ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      delete: async (id) => {
        const res = await f(urlFor(name, `/${id}`), {
          method: "DELETE",
          headers: headers(),
        });
        if (!res.ok) throw new Error(`delete ${name}/${id} failed: ${res.status}`);
      },
    };
  }

  return new Proxy({} as Client<DB>, {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      return entity(prop);
    },
  });
}
