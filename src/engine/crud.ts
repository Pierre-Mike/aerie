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
    mountEntity(app, name, entity, dyn, cfg);
  }
}

function mountEntity(
  app: App,
  name: string,
  entity: EntityDef,
  db: DynDb,
  cfg: Cfg,
): void {
  const base = `/api/${name}`;
  const hookCtx = (auth: HookCtx["auth"]): HookCtx => ({ auth, platform: { db } });

  // ── Relation helpers ─────────────────────────────────────────────────────
  const relations = entity.relations ?? {};

  async function validateBelongsTo(row: Record<string, unknown>): Promise<string | null> {
    for (const [, rel] of Object.entries(relations)) {
      if (rel.kind !== "belongsTo") continue;
      const fkValue = row[rel.fk];
      if (fkValue === undefined || fkValue === null) continue;
      const target = await db
        .selectFrom(rel.target)
        .select("id" as never)
        .where("id" as never, "=", fkValue as never)
        .executeTakeFirst();
      if (!target) return `${rel.target} with id '${String(fkValue)}' not found`;
    }
    return null;
  }

  async function expandIncludes(
    row: Record<string, unknown>,
    includes: string[],
  ): Promise<Record<string, unknown>> {
    if (includes.length === 0) return row;
    const result: Record<string, unknown> = { ...row };
    for (const includeName of includes) {
      const rel = relations[includeName];
      if (!rel) continue;
      if (rel.kind === "belongsTo") {
        const fkValue = row[rel.fk];
        if (fkValue === undefined || fkValue === null) {
          result[includeName] = null;
          continue;
        }
        const linked = await db
          .selectFrom(rel.target)
          .selectAll()
          .where("id" as never, "=", fkValue as never)
          .executeTakeFirst();
        result[includeName] = linked ?? null;
      } else if (rel.kind === "hasMany") {
        const linked = await db
          .selectFrom(rel.target)
          .selectAll()
          .where(rel.fk as never, "=", row.id as never)
          .execute();
        result[includeName] = linked;
      }
    }
    return result;
  }

  function parseIncludes(c: { req: { url: string } }): string[] {
    const url = new URL(c.req.url);
    const include = url.searchParams.get("include");
    if (!include) return [];
    return include.split(",").map((s) => s.trim()).filter(Boolean);
  }

  // LIST
  app.get(base, async (c) => {
    const auth = c.get("auth");
    const decision = evaluate(entity.policies.read, auth);
    if (decision.effect === "deny") return c.json({ error: decision.reason }, 403);

    const rows = await db.selectFrom(name).selectAll().execute();
    // Rule decisions filter post-fetch for now. Acceptable for the slice;
    // future work: compile common rule shapes to SQL where-clauses.
    const filtered =
      decision.effect === "rule" ? rows.filter((r) => decision.predicate(r)) : rows;
    const includes = parseIncludes(c);
    const expanded = await Promise.all(filtered.map((r) => expandIncludes(r, includes)));
    return c.json(expanded);
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
    const expanded = await expandIncludes(row, parseIncludes(c));
    return c.json(expanded);
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
    const fkErr = await validateBelongsTo(row);
    if (fkErr) return c.json({ error: fkErr }, 400);
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
    const fkErr = await validateBelongsTo(filteredPatch);
    if (fkErr) return c.json({ error: fkErr }, 400);
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
