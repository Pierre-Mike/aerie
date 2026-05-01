// JWT middleware. Verifies HS-* (shared secret) or RS-* (JWKS) and populates ctx.

import type { MiddlewareHandler } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";
import type { Auth, Cfg, Vars } from "./types.ts";

type Env = { Variables: Vars };

export function authMiddleware(cfg: Cfg): MiddlewareHandler<Env> {
  const userIdClaim = cfg.jwt.userIdClaim ?? "sub";
  const roleClaim = cfg.jwt.roleClaim ?? "role";

  const verify = "secret" in cfg.jwt
    ? buildHsVerifier(cfg.jwt.secret, cfg.jwt.algorithm ?? "HS256")
    : buildJwksVerifier(cfg.jwt.jwksUrl);

  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      c.set("auth", null);
      return next();
    }
    const token = header.slice(7);
    try {
      const payload = await verify(token);
      const userId = readClaim(payload, userIdClaim);
      const role = readClaim(payload, roleClaim);
      if (typeof userId !== "string") {
        c.set("auth", null);
        return next();
      }
      const auth: Auth = {
        userId,
        role: typeof role === "string" ? role : undefined,
        raw: payload,
      };
      c.set("auth", auth);
    } catch {
      c.set("auth", null);
    }
    return next();
  };
}

function buildHsVerifier(secret: string, alg: string) {
  const key = new TextEncoder().encode(secret);
  return async (token: string) => {
    const { payload } = await jwtVerify(token, key, { algorithms: [alg] });
    return payload as Record<string, unknown>;
  };
}

function buildJwksVerifier(url: string) {
  const jwks = createRemoteJWKSet(new URL(url));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks);
    return payload as Record<string, unknown>;
  };
}

function readClaim(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, payload);
}
