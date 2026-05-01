// Public health-check route. One file, one function — the unit of declaration.

import { defineRoute } from "../engine/route.ts";

export const health = defineRoute({
  method: "GET",
  path: "/health",
  auth: "public",
  handler: () => ({ status: "ok", at: new Date().toISOString() }),
});
