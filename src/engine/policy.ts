// Policy evaluator. Deny by default. Three shapes: public/authenticated/roles/rule.

import type { Auth, Policy } from "./types.ts";
import { compile } from "./expr.ts";

export type Decision =
  | { effect: "allow" }
  | { effect: "deny"; reason: string }
  | { effect: "rule"; predicate: (row: Record<string, unknown>) => boolean };

const ruleCache = new Map<string, (scope: Record<string, unknown>) => unknown>();

function compileCached(rule: string) {
  let fn = ruleCache.get(rule);
  if (!fn) {
    fn = compile(rule);
    ruleCache.set(rule, fn);
  }
  return fn;
}

/**
 * Evaluate a policy for a given auth context.
 *
 * - `public`                 → allow
 * - `authenticated`          → allow iff auth != null
 * - `{ roles: [...] }`       → allow iff auth.role ∈ roles
 * - `{ rule: "<expr>" }`     → returns predicate; LIST queries can't push down
 *                              (yet) so we filter post-fetch; GET/PATCH/DELETE
 *                              evaluate against the fetched row.
 *
 * Unknown role / missing claims → deny. Never default-allow.
 */
export function evaluate(policy: Policy, auth: Auth | null): Decision {
  if (policy === "public") return { effect: "allow" };

  if (policy === "authenticated") {
    return auth ? { effect: "allow" } : { effect: "deny", reason: "unauthenticated" };
  }

  if ("roles" in policy) {
    if (!auth) return { effect: "deny", reason: "unauthenticated" };
    if (!auth.role) return { effect: "deny", reason: "no role claim" };
    return policy.roles.includes(auth.role)
      ? { effect: "allow" }
      : { effect: "deny", reason: `role '${auth.role}' not in [${policy.roles.join(",")}]` };
  }

  if ("rule" in policy) {
    let fn: (scope: Record<string, unknown>) => unknown;
    try {
      fn = compileCached(policy.rule);
    } catch (e) {
      return { effect: "deny", reason: `rule parse error: ${(e as Error).message}` };
    }
    return {
      effect: "rule",
      predicate: (row) => {
        try {
          return Boolean(fn({ row, auth: auth ?? {} }));
        } catch {
          return false;
        }
      },
    };
  }

  return { effect: "deny", reason: "unknown policy shape" };
}

/** Apply a row-check decision to a fetched row. Used by GET/PATCH/DELETE. */
export function rowAllowed(decision: Decision, row: Record<string, unknown>): boolean {
  if (decision.effect === "allow") return true;
  if (decision.effect === "deny") return false;
  return decision.predicate(row);
}
