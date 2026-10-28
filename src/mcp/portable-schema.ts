import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

/*
 * Tool input schemas every MCP client accepts.
 *
 * Zod's JSON Schema output is valid draft 2020-12, but AI apps don't all read
 * the whole of JSON Schema. Gemini in particular takes tool parameters as an
 * OpenAPI-style subset and rejects a tool list outright when one schema has a
 * keyword it doesn't know (`$schema`, `exclusiveMinimum`, `const`, most
 * `format`s, `additionalProperties`) or an object with no properties. One bad
 * tool is enough for the whole connector to misbehave.
 *
 * `portable()` keeps the Zod schema for validation, so what the server accepts
 * doesn't change, and only rewrites the JSON Schema that `tools/list`
 * advertises into the subset Claude, ChatGPT, Gemini, Muse and the rest all
 * understand.
 */

type JsonObject = { [key: string]: unknown };

/** Keywords that carry no meaning for a model and that strict clients reject. */
const DROPPED = new Set([
  "$schema",
  "$id",
  "$comment",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "examples",
  "readOnly",
  "writeOnly",
  "deprecated",
  "contentEncoding",
  "contentMediaType",
]);

/** String formats Gemini's schema accepts; the rest are dropped (a `pattern` still says the shape). */
const PORTABLE_FORMATS = new Set(["date-time", "enum"]);

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function typeOfValue(value: unknown) {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  return undefined;
}

const isNullSchema = (schema: unknown) =>
  isObject(schema) && schema.type === "null";

/** Rewrites one JSON Schema node (and everything under it) into the portable subset. */
export function toPortableJsonSchema(schema: unknown): JsonObject {
  if (!isObject(schema)) return {};
  const out: JsonObject = {};

  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED.has(key)) continue;
    switch (key) {
      case "properties":
        if (isObject(value)) {
          out.properties = Object.fromEntries(
            Object.entries(value).map(([name, child]) => [
              name,
              toPortableJsonSchema(child),
            ]),
          );
        }
        break;
      case "items":
        out.items = toPortableJsonSchema(value);
        break;
      case "anyOf":
      case "oneOf":
        if (Array.isArray(value)) {
          out.anyOf = value.map((branch) => toPortableJsonSchema(branch));
        }
        break;
      case "const": {
        out.enum = [value];
        const type = typeOfValue(value);
        if (type && out.type === undefined) out.type = type;
        break;
      }
      case "exclusiveMinimum":
        if (typeof value === "number") {
          const current = schema.minimum;
          out.minimum =
            typeof current === "number" ? Math.max(current, value) : value;
        }
        break;
      case "exclusiveMaximum":
        if (typeof value === "number") {
          const current = schema.maximum;
          out.maximum =
            typeof current === "number" ? Math.min(current, value) : value;
        }
        break;
      case "minimum":
        if (out.minimum === undefined || typeof value !== "number") {
          out.minimum = value;
        } else {
          out.minimum = Math.max(out.minimum as number, value);
        }
        break;
      case "maximum":
        if (out.maximum === undefined || typeof value !== "number") {
          out.maximum = value;
        } else {
          out.maximum = Math.min(out.maximum as number, value);
        }
        break;
      case "format":
        if (typeof value === "string" && PORTABLE_FORMATS.has(value)) {
          out.format = value;
        }
        break;
      case "type":
        if (Array.isArray(value)) {
          const nonNull = value.filter((t) => t !== "null");
          if (nonNull.length !== value.length) out.nullable = true;
          if (nonNull.length === 1) out.type = nonNull[0];
          else if (nonNull.length > 1) out.type = nonNull;
        } else {
          out.type = value;
        }
        break;
      default:
        out[key] = value;
    }
  }

  // `X | null` (Zod's .nullable()) as a typed schema that may be null, not a
  // union with a "null" type most clients can't represent.
  if (Array.isArray(out.anyOf)) {
    const branches = (out.anyOf as JsonObject[]).filter(
      (branch) => !isNullSchema(branch),
    );
    if (branches.length !== out.anyOf.length) {
      if (branches.length === 1) {
        delete out.anyOf;
        const [only] = branches;
        for (const [key, value] of Object.entries(only ?? {})) {
          if (!(key in out)) out[key] = value;
        }
      } else {
        out.anyOf = branches;
      }
      out.nullable = true;
    }
  }

  // An enum always says its type, so clients don't have to guess.
  if (
    Array.isArray(out.enum) &&
    out.type === undefined &&
    out.anyOf === undefined
  ) {
    const types = new Set(out.enum.map(typeOfValue));
    const [only] = types;
    if (types.size === 1 && only) out.type = only;
  }

  if (out.type === "object" && out.properties === undefined) {
    out.properties = {};
  }
  return out;
}

/**
 * The same schema for validation, advertised in the portable subset. Use it
 * for every tool's `inputSchema`.
 */
export function portable<Schema extends StandardSchemaWithJSON>(
  schema: Schema,
): Schema {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      jsonSchema: {
        input: (options) =>
          toPortableJsonSchema(standard.jsonSchema.input(options)),
        output: (options) =>
          toPortableJsonSchema(standard.jsonSchema.output(options)),
      },
    },
  } as Schema;
}
