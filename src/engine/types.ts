// Config schema and derived types. The single source of truth for an aerie app.

export type FieldType = "string" | "int" | "bool" | "datetime";

export type FieldDef =
  | FieldType
  | { type: FieldType; required?: boolean; default?: unknown };

export type Policy =
  | "public"
  | "authenticated"
  | { roles: readonly string[] }
  | { rule: string }; // arbitrary expression — see engine/expr.ts

/** Subset of Policy valid for custom routes — no row rules (no row context). */
export type RoutePolicy =
  | "public"
  | "authenticated"
  | { roles: readonly string[] };

export type EntityDef = {
  fields: Record<string, FieldDef>;
  policies: {
    create: Policy;
    read: Policy;
    update: Policy;
    delete: Policy;
  };
  hooks?: Hooks;
};

export type HookCtx = {
  auth: Auth | null;
  platform: { db: unknown };
};

export type Hooks = {
  beforeCreate?: (row: Record<string, unknown>, ctx: HookCtx) =>
    | Record<string, unknown>
    | Promise<Record<string, unknown>>;
  afterCreate?: (row: Record<string, unknown>, ctx: HookCtx) => void | Promise<void>;
  beforeUpdate?: (
    patch: Record<string, unknown>,
    prev: Record<string, unknown>,
    ctx: HookCtx,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  afterUpdate?: (
    row: Record<string, unknown>,
    prev: Record<string, unknown>,
    ctx: HookCtx,
  ) => void | Promise<void>;
  beforeDelete?: (row: Record<string, unknown>, ctx: HookCtx) => void | Promise<void>;
  afterDelete?: (row: Record<string, unknown>, ctx: HookCtx) => void | Promise<void>;
};

export type Cfg = {
  jwt:
    | { secret: string; userIdClaim?: string; roleClaim?: string; algorithm?: "HS256" | "HS384" | "HS512" }
    | { jwksUrl: string; userIdClaim?: string; roleClaim?: string };
  entities: Record<string, EntityDef>;
  routes?: readonly RouteDefAny[];
};

// ── Custom routes ─────────────────────────────────────────────────────────────
export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Anything with a `.parse(unknown) => T` works — Zod, Valibot, hand-rolled. */
export type Validator<T> = { parse: (input: unknown) => T };

export type RouteCtx<B> = {
  auth: Auth | null;
  body: B;
  params: Record<string, string>;
  query: URLSearchParams;
};

export type RouteDef<B = undefined> = {
  method: Method;
  path: string;
  auth?: RoutePolicy;
  body?: Validator<B>;
  handler: (ctx: RouteCtx<B>) => Promise<unknown> | unknown;
};

/** Erased form for storage in the routes array. */
export type RouteDefAny = RouteDef<any>;

// ── Type-level field → TS type mapping ────────────────────────────────────────
type ResolveType<T> = T extends FieldType
  ? T
  : T extends { type: infer U }
    ? U
    : never;

type TsType<T extends FieldType> = T extends "string"
  ? string
  : T extends "int"
    ? number
    : T extends "bool"
      ? boolean
      : T extends "datetime"
        ? string
        : never;

export type RowOf<E extends EntityDef> = { id: string } & {
  [K in keyof E["fields"]]: TsType<ResolveType<E["fields"][K]>>;
};

// Map an entire config to its DB type — used by Kysely.
export type DbOf<C extends Cfg> = {
  [K in keyof C["entities"]]: RowOf<C["entities"][K] extends EntityDef ? C["entities"][K] : never>;
};

// Auth context attached to each authenticated request.
export type Auth = {
  userId: string;
  role?: string;
  raw: Record<string, unknown>;
};

// Hono context variables.
export type Vars = {
  auth: Auth | null;
};
