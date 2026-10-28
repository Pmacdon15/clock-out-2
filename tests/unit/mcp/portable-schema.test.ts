import { describe, expect, it, vi } from "vitest";

vi.mock("@/mcp/db", () => ({}));
vi.mock("@/lib/reports", () => ({}));

import { portable, toPortableJsonSchema } from "@/mcp/portable-schema";
import {
  addTimeEntryInputSchema,
  clockInInputSchema,
  clockOutInputSchema,
  deleteTimeEntryInputSchema,
  getClockStatusInputSchema,
  getWeeklyTimecardInputSchema,
  listMembersInputSchema,
  listOrganizationsInputSchema,
  listTimeEntriesInputSchema,
  manageReportingSettingsInputSchema,
  updateTimeEntryInputSchema,
  whoIsWorkingInputSchema,
} from "@/mcp/tools";

const FORBIDDEN_KEYWORDS = [
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
  "const",
  "exclusiveMinimum",
  "exclusiveMaximum",
];

function collectKeys(obj: unknown, found = new Set<string>()): Set<string> {
  if (!obj || typeof obj !== "object") return found;
  if (Array.isArray(obj)) {
    for (const item of obj) collectKeys(item, found);
    return found;
  }
  for (const [k, v] of Object.entries(obj)) {
    found.add(k);
    collectKeys(v, found);
  }
  return found;
}

describe("portable JSON schema", () => {
  const schemas = {
    list_organizations: listOrganizationsInputSchema,
    list_members: listMembersInputSchema,
    who_is_working: whoIsWorkingInputSchema,
    get_clock_status: getClockStatusInputSchema,
    clock_in: clockInInputSchema,
    clock_out: clockOutInputSchema,
    add_time_entry: addTimeEntryInputSchema,
    list_time_entries: listTimeEntriesInputSchema,
    get_weekly_timecard: getWeeklyTimecardInputSchema,
    update_time_entry: updateTimeEntryInputSchema,
    delete_time_entry: deleteTimeEntryInputSchema,
    manage_reporting_settings: manageReportingSettingsInputSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`produces a Gemini/Claude/Muse-compatible JSON schema for ${name}`, () => {
      const wrapped = portable(schema);
      const json = wrapped["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      });
      const keys = collectKeys(json);
      for (const bad of FORBIDDEN_KEYWORDS) {
        expect(keys.has(bad), `${name} has forbidden keyword ${bad}`).toBe(
          false,
        );
      }
      expect((json as { type?: string }).type).toBe("object");
      expect((json as { properties?: unknown }).properties).toBeDefined();
    });
  }

  it("rewrites nullable unions to nullable: true", () => {
    const rewritten = toPortableJsonSchema({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(rewritten).toEqual({ type: "string", nullable: true });
  });
});
