// Custom route system. Each route lives in its own file, exports one function,
// is composed into the app via `cfg.routes`. Same Policy DSL as entities.

import type { Hono } from "hono";
import type { PlatformLite, RouteDef, RouteDefAny, Vars } from "./types.ts";
import { evaluate } from "./policy.ts";

type App = Hono<{ Variables: Vars }>;

/** Identity helper that preserves the body-validator type for handler inference. */
export function defineRoute<B = undefined>(def: RouteDef<B>): RouteDef<B> {
  return def;
}

export function mountRoutes(
  app: App,
  routes: readonly RouteDefAny[],
  platform: PlatformLite,
): void {
  for (const route of routes) {
    const method = route.method.toLowerCase() as "get" | "post" | "patch" | "delete";

    app[method](route.path, async (c) => {
      if (route.auth) {
        const decision = evaluate(route.auth, c.get("auth"));
        if (decision.effect === "deny") {
          return c.json({ error: decision.reason }, 403);
        }
        // RoutePolicy excludes `rule` by construction — this guards against
        // future type narrowing weakening.
        if (decision.effect === "rule") {
          return c.json({ error: "row rules not allowed on custom routes" }, 500);
        }
      }

      let body: unknown = undefined;
      if (route.body) {
        try {
          const raw = await c.req.json();
          body = route.body.parse(raw);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "invalid body";
          return c.json({ error: msg }, 400);
        }
      }

      const result = await route.handler({
        auth: c.get("auth"),
        body,
        params: c.req.param() as Record<string, string>,
        query: new URL(c.req.url).searchParams,
        req: c.req.raw,
        platform,
      });

      if (result instanceof Response) return result;
      if (result === undefined) return c.body(null, 204);
      return c.json(result as object);
    });
  }
}
