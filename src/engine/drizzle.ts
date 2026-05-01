// Bridge: derive aerie's `fields` map from a Drizzle table so the schema is
// defined once (in Drizzle) and aerie just reads its column metadata.

import { getTableColumns, type Table } from "drizzle-orm";
import type { FieldType } from "./types.ts";

const DATA_TYPE: Record<string, FieldType> = {
  string: "string",
  number: "int",
  boolean: "bool",
  date: "datetime",
};

export function fieldsFrom(table: Table): Record<string, FieldType> {
  const out: Record<string, FieldType> = {};
  for (const [name, col] of Object.entries(getTableColumns(table))) {
    if (name === "id") continue;
    const t = DATA_TYPE[col.dataType];
    if (!t) {
      throw new Error(
        `fieldsFrom: unsupported Drizzle dataType "${col.dataType}" on column "${name}"`,
      );
    }
    out[name] = t;
  }
  return out;
}
