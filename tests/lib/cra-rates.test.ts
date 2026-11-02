// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  fetchCraPayrollRates,
  findCsvLinks,
  findLatestEdition,
  parseAmount,
  parseCraTables,
  parseCsv,
  readTable,
  T4127_INDEX_URL,
} from "@/lib/cra-rates";
import { SEED_PAYROLL_RATES, validatePayrollRates } from "@/lib/payroll";

/** Real files from the CRA's T4127 July 2026 edition. */
const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "../fixtures/cra", name), "utf8");

const CSV = {
  pension: fixture("cpp-qpp-ttl-01-26e.csv"),
  pension2: fixture("cpp-qpp-scnd-addntl-01-26e.csv"),
  ei: fixture("ei-01-26e.csv"),
};
const INDEX = fixture("t4127-index.html");
const EDITION = fixture("t4127-jul.html");
const EDITION_URL =
  "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul.html";
const DAM = "https://www.canada.ca/content/dam/cra-arc/formspubs/pub/t4127-jan";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes, CRLF and a missing final newline", () => {
    expect(parseCsv('a,"1,000","say ""hi"""\r\nb,2')).toEqual([
      ["a", "1,000", 'say "hi"'],
      ["b", "2"],
    ]);
    expect(parseCsv("x,\n")).toEqual([["x", ""]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("parseAmount", () => {
  it("reads formatted numbers", () => {
    expect(parseAmount("74,600.00")).toBe(74600);
    expect(parseAmount("$ 416")).toBe(416);
  });

  it("throws on blanks and text", () => {
    expect(() => parseAmount("")).toThrow("Not a number");
    expect(() => parseAmount(undefined)).toThrow("Not a number");
    expect(() => parseAmount("n/a")).toThrow("Not a number");
  });
});

describe("parseCraTables", () => {
  it("reads the real 2026 tables into rows matching the seed", () => {
    const rows = parseCraTables(CSV, "2026-01-01");
    expect(rows).toEqual(SEED_PAYROLL_RATES);
    for (const row of rows) expect(validatePayrollRates(row)).toBeNull();
  });

  it("finds columns by header, not position", () => {
    const text = [
      "Title",
      "EI,Maximum Annual Employer Premium,Maximum Annual Employee Premium,Employer Contribution Rate,Employee Contribution Rate,Maximum Annual Insurable Earnings",
      "Canada except QC,2,1,0.02,0.01,100",
      "QC,4,3,0.04,0.03,200",
    ].join("\n");
    const table = readTable(
      text,
      {
        insurable: /insurable earnings/i,
        employee: /employee contribution rate/i,
      },
      "EI",
    );
    expect(table).toEqual({
      CA: { insurable: 100, employee: 0.01 },
      QC: { insurable: 200, employee: 0.03 },
    });
  });

  it("throws when the header changes", () => {
    expect(() =>
      parseCraTables(
        { ...CSV, ei: CSV.ei.replace("Insurable", "Covered") },
        "2026-01-01",
      ),
    ).toThrow("Table 8.7: expected columns not found");
  });

  it("throws when a jurisdiction row is missing", () => {
    expect(() =>
      parseCraTables(
        { ...CSV, pension2: CSV.pension2.replace("QPP (QC)", "Other") },
        "2026-01-01",
      ),
    ).toThrow("Table 8.6: missing a jurisdiction row");
  });

  it("throws when a value isn't a number", () => {
    expect(() =>
      parseCraTables(
        { ...CSV, pension: CSV.pension.replace("0.0595", "TBD") },
        "2026-01-01",
      ),
    ).toThrow('Not a number: "TBD"');
  });
});

describe("findLatestEdition", () => {
  it("picks the newest edition and its effective date", () => {
    expect(findLatestEdition(INDEX)).toEqual({
      url: EDITION_URL,
      effectiveFrom: "2026-07-01",
    });
  });

  it("handles next year's January edition and &nbsp;", () => {
    const html = `${INDEX}<a href="/en/x/t4127-jan.html">Payroll Deductions Formulas - 124th Edition - Effective January&nbsp;1, 2027</a>`;
    expect(findLatestEdition(html).effectiveFrom).toBe("2027-01-01");
  });

  it("ignores edition links without a date", () => {
    const html = '<a href="/en/x/t4127-jul.html">Current edition</a>';
    expect(() => findLatestEdition(html)).toThrow("No T4127 edition found");
  });
});

describe("findCsvLinks", () => {
  it("finds the three tables among the other CSVs", () => {
    expect(findCsvLinks(EDITION, EDITION_URL)).toEqual({
      pension: `${DAM}/cpp-qpp-ttl-01-26e.csv`,
      pension2: `${DAM}/cpp-qpp-scnd-addntl-01-26e.csv`,
      ei: `${DAM}/ei-01-26e.csv`,
    });
  });

  it("throws when a table is no longer linked", () => {
    expect(() =>
      findCsvLinks(EDITION.replace("ei-01-26e.csv", "ei.pdf"), EDITION_URL),
    ).toThrow("No Employment Insurance CSV linked");
  });
});

describe("fetchCraPayrollRates", () => {
  const pages: Record<string, string> = {
    [T4127_INDEX_URL]: INDEX,
    [EDITION_URL]: EDITION,
    [`${DAM}/cpp-qpp-ttl-01-26e.csv`]: CSV.pension,
    [`${DAM}/cpp-qpp-scnd-addntl-01-26e.csv`]: CSV.pension2,
    [`${DAM}/ei-01-26e.csv`]: CSV.ei,
  };
  const fakeFetch = vi.fn(async (url: string) =>
    url in pages
      ? new Response(pages[url])
      : new Response("missing", { status: 404 }),
  );

  it("follows the index to the edition and its CSVs", async () => {
    const result = await fetchCraPayrollRates(fakeFetch);
    expect(result.source).toBe(EDITION_URL);
    expect(result.rates).toEqual(
      SEED_PAYROLL_RATES.map((r) => ({ ...r, effectiveFrom: "2026-07-01" })),
    );
  });

  it("throws on an HTTP error", async () => {
    delete pages[`${DAM}/ei-01-26e.csv`];
    await expect(fetchCraPayrollRates(fakeFetch)).rejects.toThrow(
      "failed with 404",
    );
  });

  it("uses the global fetch by default, uncached", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 503 }));
    await expect(fetchCraPayrollRates()).rejects.toThrow("failed with 503");
    expect(spy).toHaveBeenCalledWith(T4127_INDEX_URL, { cache: "no-store" });
    spy.mockRestore();
  });
});
