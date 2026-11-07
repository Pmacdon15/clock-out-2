import { describe, expect, it } from "vitest";
import {
  exportToSheetsArgsSchema,
  exportToSheetsPromptText,
  registerClockOutPrompts,
} from "@/mcp/prompts";

type PromptConfig = {
  title?: string;
  description?: string;
  argsSchema?: unknown;
};
type PromptCallback = (args: Record<string, string | undefined>) => {
  messages: { role: string; content: { type: string; text: string } }[];
};

function registered() {
  const prompts = new Map<
    string,
    { config: PromptConfig; cb: PromptCallback }
  >();
  const server = {
    registerPrompt: (
      name: string,
      config: PromptConfig,
      cb: PromptCallback,
    ) => {
      prompts.set(name, { config, cb });
    },
  };
  registerClockOutPrompts(server as never);
  return prompts;
}

describe("Clock Out MCP prompts", () => {
  const prompts = registered();

  it("registers the export-timesheet-to-sheets prompt", () => {
    expect([...prompts.keys()]).toEqual(["export-timesheet-to-sheets"]);
    const prompt = prompts.get("export-timesheet-to-sheets");
    expect(prompt?.config.title).toBe("Export timesheet to Google Sheets");
    expect(prompt?.config.description).toMatch(/Google Sheets connector/);
    expect(prompt?.config.argsSchema).toBe(exportToSheetsArgsSchema);
  });

  it("returns one user message with the instructions", () => {
    const result = prompts
      .get("export-timesheet-to-sheets")
      ?.cb({ period: "last pay period" });
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]?.role).toBe("user");
    expect(result?.messages[0]?.content.type).toBe("text");
    expect(result?.messages[0]?.content.text).toContain("last pay period");
  });

  it("only takes optional string arguments", () => {
    expect(exportToSheetsArgsSchema.parse({})).toEqual({});
    expect(exportToSheetsArgsSchema.safeParse({ period: 3 }).success).toBe(
      false,
    );
  });
});

describe("exportToSheetsPromptText", () => {
  it("defaults to the current week and a new spreadsheet", () => {
    const text = exportToSheetsPromptText({});
    expect(text).toContain("timesheet for the current week into Google Sheets");
    expect(text).toContain("call the Clock Out tool get_timesheet_tables");
    expect(text).toContain("Create a new spreadsheet");
    expect(text).toContain("suggested_spreadsheet_title");
    expect(text).not.toContain('member "');
  });

  it("names the member and writes into an existing spreadsheet when given", () => {
    const text = exportToSheetsPromptText({
      period: " October 2026 ",
      member: " Alex ",
      spreadsheet: "Payroll 2026",
    });
    expect(text).toContain("timesheet for October 2026 for Alex into");
    expect(text).toContain('and member "Alex"');
    expect(text).toContain('Open the existing spreadsheet "Payroll 2026"');
    expect(text).toContain("ask me before overwriting them");
    expect(text).not.toContain("Create a new spreadsheet");
  });

  it("treats blank arguments as not given", () => {
    expect(
      exportToSheetsPromptText({ period: "  ", member: "", spreadsheet: " " }),
    ).toBe(exportToSheetsPromptText({}));
  });

  it("tells the AI to write raw values and to fall back to file downloads", () => {
    const text = exportToSheetsPromptText({});
    expect(text).toContain("raw values (not user-entered or formulas)");
    expect(text).toContain("call export_timesheet instead");
  });
});
