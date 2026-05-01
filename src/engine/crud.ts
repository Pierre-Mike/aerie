// CRUD route factory. One pass over `cfg.entities` mounts read/list/create/update/delete.

import type { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Cfg, EntityDef, HookCtx, Vars } from "./types.ts";
import { evaluate, rowAllowed } from "./policy.ts";

type App = Hono<{ Variables: Vars }>;
type DynDb = Kysely<Record<string, Record<string, unknown>>>;

export function mountCrud<DB>(app: App, cfg: Cfg, db: Kysely<DB>): void {
  // The CRUD engine treats every table as a Record<string, unknown>; field
  // validation handles shape. The end-user keeps strict types via Kysely
  // when they query the same instance directly.
  const dyn = db as unknown as DynDb;
  for (const [name, entity] of Object.entries(cfg.entities)) {
    mountEntity(app, name, entity, dyn);
  }
}

function mountEntity(
  app: App,
  name: string,
  entity: EntityDef,
  db: DynDb,
): void {
  const base = `/api/${name}`;
  const hookCtx = (auth: HookCtx["auth"]): HookCtx => ({ auth, platform: { db } });

  // LIST
  app.get(base, async (c) => {
    const auth = c.get("auth");
    const decision = evaluate(entity.policies.read, auth);
    if (decision.effect === "deny") return c.json({ error: decision.reason }, 403);

    let q = db.selectFrom(name).selectAll();
    if (decision.effect === "filter") {
      q = q.where(decision.column as never, "=", decision.value as never);
    }
    const rows = await q.execute();
    return c.json(rows);
  });

  // GET
  app.get(`${base}/:id`, async (c) => {
    const auth = c.get("auth");
    const decision = evaluate(entity.policies.read, auth);
    if (decision.effect === "deny") return c.json({ error: decision.reason }, 403);

    const row = await db
      .selectFrom(name)
      .selectAll()
      .where("id" as never, "=", c.req.param("id") as never)
      .executeTakeFirst();
    if (!row) return c.json({ error: "not found" }, 404);
    if (!rowAllowed(decision, row)) return c.json({ error: "forbidden" }, 403);
    return c.json(row);
  });

  // CREATE
  app.post(base, async (c) => {
    const auth = c.get("auth");
    const decision = evaluate(entity.policies.create, auth);
    if (decision.effect === "deny") return c.json({ error: decision.reason }, 403);

    const body = (await c.req.json()) as Record<string, unknown>;
    const validated = validate(entity, body);
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    const id = crypto.randomUUID();
    let row: Record<string, unknown> = { id, ...validated.value };
    if (entity.hooks?.beforeCreate) {
      row = await entity.hooks.beforeCreate(row, hookCtx(auth));
    }
    await db.insertInto(name).values(row as never).execute();
    if (entity.hooks?.afterCreate) {
      await entity.hooks.afterCreate(row, hookCtx(auth));
    }
    return c.json(row, 201);
  });

  // UPDATE
  app.patch(`${base}/:id`, async (c) => {
    const auth = c.get("auth");
    const decision = evaluate(entity.policies.update, auth);
    if (decision.effect === "deny") return c.json({ error: decision.reason }, 403);

    const id = c.req.param("id");
    const existing = await db
      .selectFrom(name)
      .selectAll()
      .where("id" as never, "=", id as never)
      .executeTakeFirst();
    if (!existing) return c.json({ error: "not found" }, 404);
    if (!rowAllowed(decision, existing)) return c.json({ error: "forbidden" }, 403);

    const patch = (await c.req.json()) as Record<string, unknown>;
    let filteredPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id") continue;
      if (k in entity.fields) filteredPatch[k] = v;
    }
    if (entity.hooks?.beforeUpdate) {
      filteredPatch = await entity.hooks.beforeUpdate(filteredPatch, existing, hookCtx(auth));
    }
    if (Object.keys(filteredPatch).length === 0) {
      return c.json(existing);
    }
    await db
      .updateTable(name)
      .set(filteredPatch as never)
      .where("id" as never, "=", id as never)
      .execute();
    const updated = await db
      .selectFrom(name)
      .selectAll()
      .where("id" as never, "=", id as never)
      .executeTakeFirst();
    if (entity.hooks?.afterUpdate && updated) {
      await entity.hooks.afterUpdate(updated, existing, hookCtx(auth));
    }
    return c.json(updated);
  });

  // DELETE
  app.delete(`${base}/:id`, async (c) => {
    const auth = c.get("auth");
    const decision = evaluate(entity.policies.delete, auth);
    if (decision.effect === "deny") return c.json({ error: decision.reason }, 403);

    const id = c.req.param("id");
    const existing = await db
      .selectFrom(name)
      .selectAll()
      .where("id" as never, "=", id as never)
      .executeTakeFirst();
    if (!existing) return c.json({ error: "not found" }, 404);
    if (!rowAllowed(decision, existing)) return c.json({ error: "forbidden" }, 403);

    if (entity.hooks?.beforeDelete) {
      await entity.hooks.beforeDelete(existing, hookCtx(auth));
    }
    await db.deleteFrom(name).where("id" as never, "=", id as never).execute();
    if (entity.hooks?.afterDelete) {
      await entity.hooks.afterDelete(existing, hookCtx(auth));
    }
    return c.body(null, 204);
  });
}

// ── Minimal field validation. Type checks + required. ───────────────────────
function validate(
  entity: EntityDef,
  body: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(entity.fields)) {
    const type = typeof def === "string" ? def : def.type;
    const required = typeof def === "string" ? true : (def.required ?? true);
    const value = body[name];

    if (value === undefined) {
      if (required) return { ok: false, error: `missing field: ${name}` };
      continue;
    }
    if (!checkType(type, value)) {
      return { ok: false, error: `field ${name} expected ${type}, got ${typeof value}` };
    }
    out[name] = value;
  }
  return { ok: true, value: out };
}

function checkType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
    case "datetime":
      return typeof value === "string";
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "bool":
      return typeof value === "boolean";
    default:
      return false;
  }
}
