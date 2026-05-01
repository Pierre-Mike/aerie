// Upload route — accepts a binary body and stores it via platform.storage.
// Returns the storage key, which the caller saves into a `file` field on an entity.

import { defineRoute } from "../engine/route.ts";

export const upload = defineRoute({
  method: "POST",
  path: "/upload",
  auth: { roles: ["user", "admin"] },
  handler: async ({ auth, req, platform }) => {
    if (!platform.storage) {
      return new Response(JSON.stringify({ error: "storage not configured" }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });
    }
    const contentType = req.headers.get("content-type") ?? "application/octet-stream";
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength === 0) {
      return new Response(JSON.stringify({ error: "empty body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const key = `${auth?.userId ?? "anon"}/${crypto.randomUUID()}`;
    await platform.storage.put(key, body, contentType);
    return { key, size: body.byteLength, contentType };
  },
});
