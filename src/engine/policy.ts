// Policy evaluator. Deny by default. Three shapes only for the slice.

import type { Auth, Policy } from "./types.ts";

export type Decision =
  | { effect: "allow" }
  | { effect: "deny"; reason: string }
  | { effect: "filter"; column: "authorId"; value: string };

/**
 * Evaluate a policy for a given auth context.
 *
 * - `public`                              → allow
 * - `authenticated`                       → allow iff auth != null
 * - `{ roles: [...] }`                    → allow iff auth.role ∈ roles
 * - `{ rule: "row.authorId == auth.userId" }` → filter (read) or row-check (update/delete)
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
    if (!auth) return { effect: "deny", reason: "unauthenticated" };
    // The only supported rule in the slice. Easy to extend with jsep later.
    if (policy.rule === "row.authorId == auth.userId") {
      return { effect: "filter", column: "authorId", value: auth.userId };
    }
    return { effect: "deny", reason: `unsupported rule: ${policy.rule}` };
  }

  return { effect: "deny", reason: "unknown policy shape" };
}

/** Apply a row-check decision to a fetched row. Used by update/delete. */
export function rowAllowed(decision: Decision, row: Record<string, unknown>): boolean {
  if (decision.effect === "allow") return true;
  if (decision.effect === "deny") return false;
  // filter → row must match
  return row[decision.column] === decision.value;
}
