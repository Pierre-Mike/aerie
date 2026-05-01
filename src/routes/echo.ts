// Authenticated echo route — demonstrates body validation + role gating + auth ctx.

import { defineRoute } from "../engine/route.ts";

const echoBody = {
  parse: (input: unknown): { message: string } => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { message?: unknown }).message !== "string"
    ) {
      throw new Error("expected { message: string }");
    }
    return { message: (input as { message: string }).message };
  },
};

export const echo = defineRoute({
  method: "POST",
  path: "/echo",
  auth: { roles: ["user", "admin"] },
  body: echoBody,
  handler: ({ auth, body }) => ({
    echoed: body.message,
    by: auth?.userId,
    role: auth?.role,
  }),
});
