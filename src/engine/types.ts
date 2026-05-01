// Config schema and derived types. The single source of truth for an aerie app.

export type FieldType = "string" | "int" | "bool" | "datetime";

export type FieldDef =
  | FieldType
  | { type: FieldType; required?: boolean; default?: unknown };

export type Policy =
  | "public"
  | "authenticated"
  | { roles: readonly string[] }
  | { rule: "row.authorId == auth.userId" }; // limited rule set for the slice

export type EntityDef = {
  fields: Record<string, FieldDef>;
  policies: {
    create: Policy;
    read: Policy;
    update: Policy;
    delete: Policy;
  };
};

export type Cfg = {
  jwt:
    | { secret: string; userIdClaim?: string; roleClaim?: string; algorithm?: "HS256" | "HS384" | "HS512" }
    | { jwksUrl: string; userIdClaim?: string; roleClaim?: string };
  entities: Record<string, EntityDef>;
};

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
