import type { PayrollJurisdiction, PayrollRates } from "./payroll";

/**
 * Reads CPP/QPP and EI figures from the CRA's T4127 "Payroll Deductions
 * Formulas" publication. The CRA posts each edition (effective January 1 and
 * July 1) as an HTML page that links machine-readable CSV tables:
 *
 * - Table 8.3, CPP/QPP contribution rates and amounts (`cpp-qpp-ttl-…csv`)
 * - Table 8.6, second additional CPP/QPP (`cpp-qpp-scnd-addntl-…csv`)
 * - Table 8.7, Employment Insurance (`ei-…csv`)
 *
 * Columns are found by their header text rather than position, and anything
 * unexpected throws, so a layout change fails loudly instead of producing
 * wrong numbers.
 */

export const T4127_INDEX_URL =
  "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html";

const MONTHS: Record<string, string> = { january: "01", july: "07" };

/** Splits CSV text into rows of cells (quoted cells may contain commas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

/** "74,600.00" → 74600. Throws on anything that isn't a number. */
export function parseAmount(cell: string | undefined): number {
  const value = Number((cell ?? "").replace(/[$,\s]/g, ""));
  if ((cell ?? "").trim() === "" || !Number.isFinite(value)) {
    throw new Error(`Not a number: "${cell}"`);
  }
  return value;
}

type Columns<K extends string> = Record<K, RegExp>;

/**
 * The jurisdiction rows of a CRA table, keyed by "CA" / "QC", with each
 * requested column parsed as a number.
 */
export function readTable<K extends string>(
  text: string,
  columns: Columns<K>,
  table: string,
): Record<PayrollJurisdiction, Record<K, number>> {
  const rows = parseCsv(text);
  const keys = Object.keys(columns) as K[];
  const headerIndex = rows.findIndex((row) =>
    keys.every((key) => row.some((cell) => columns[key].test(cell))),
  );
  if (headerIndex === -1) {
    throw new Error(`${table}: expected columns not found`);
  }
  const header = rows[headerIndex];
  const index = Object.fromEntries(
    keys.map((key) => [
      key,
      header.findIndex((cell) => columns[key].test(cell)),
    ]),
  ) as Record<K, number>;

  const found: Partial<Record<PayrollJurisdiction, Record<K, number>>> = {};
  for (const row of rows.slice(headerIndex + 1)) {
    const label = row[0].trim();
    const jurisdiction: PayrollJurisdiction | null =
      /^(CPP|Canada except)/i.test(label)
        ? "CA"
        : /^(QPP|QC)\b/i.test(label)
          ? "QC"
          : null;
    if (!jurisdiction) continue;
    found[jurisdiction] = Object.fromEntries(
      keys.map((key) => [key, parseAmount(row[index[key]])]),
    ) as Record<K, number>;
  }
  if (!found.CA || !found.QC) {
    throw new Error(`${table}: missing a jurisdiction row`);
  }
  return found as Record<PayrollJurisdiction, Record<K, number>>;
}

const PENSION_COLUMNS = {
  ympe: /maximum pensionable earnings/i,
  basicExemption: /basic exemption/i,
  rate: /contribution rate/i,
  maxContribution: /maximum.*contribution\b/i,
};
const PENSION2_COLUMNS = {
  yampe: /additional maximum pensionable earnings/i,
  rate: /contribution rate/i,
  maxContribution: /maximum.*contribution\b/i,
};
const EI_COLUMNS = {
  maxInsurableEarnings: /insurable earnings/i,
  employeeRate: /employee contribution rate/i,
  employerRate: /employer contribution rate/i,
  maxEmployeePremium: /maximum annual employee premium/i,
  maxEmployerPremium: /maximum annual employer premium/i,
};

/** Builds both jurisdictions' rows from the three CSV tables. */
export function parseCraTables(
  csv: { pension: string; pension2: string; ei: string },
  effectiveFrom: string,
): PayrollRates[] {
  const pension = readTable(csv.pension, PENSION_COLUMNS, "Table 8.3");
  const pension2 = readTable(csv.pension2, PENSION2_COLUMNS, "Table 8.6");
  const ei = readTable(csv.ei, EI_COLUMNS, "Table 8.7");
  return (["CA", "QC"] as const).map((jurisdiction) => ({
    jurisdiction,
    effectiveFrom,
    pension: pension[jurisdiction],
    pension2: pension2[jurisdiction],
    ei: ei[jurisdiction],
  }));
}

const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const anchors = (html: string, base: string) =>
  Array.from(
    html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  ).map(([, href, body]) => ({
    url: new URL(href.replace(/&amp;/g, "&"), base).toString(),
    text: decode(body),
  }));

/**
 * The newest edition linked from the T4127 index page, with the date it takes
 * effect ("Effective July 1, 2026" → 2026-07-01).
 */
export function findLatestEdition(
  html: string,
  base: string = T4127_INDEX_URL,
): { url: string; effectiveFrom: string } {
  let latest: { url: string; effectiveFrom: string } | null = null;
  for (const link of anchors(html, base)) {
    if (!/t4127-(jan|jul)\.html$/i.test(new URL(link.url).pathname)) continue;
    const match = link.text.match(
      /effective (january|july) (\d{1,2}), (\d{4})/i,
    );
    if (!match) continue;
    const effectiveFrom = `${match[3]}-${MONTHS[match[1].toLowerCase()]}-${match[2].padStart(2, "0")}`;
    if (!latest || effectiveFrom > latest.effectiveFrom) {
      latest = { url: link.url, effectiveFrom };
    }
  }
  if (!latest) throw new Error("No T4127 edition found on the index page");
  return latest;
}

/** The three CSV links an edition page needs. */
export function findCsvLinks(
  html: string,
  base: string,
): { pension: string; pension2: string; ei: string } {
  const urls = anchors(html, base)
    .map((link) => link.url)
    .filter((url) => /\.csv$/i.test(new URL(url).pathname));
  const pick = (pattern: RegExp, name: string) => {
    const url = urls.find((candidate) =>
      pattern.test(new URL(candidate).pathname),
    );
    if (!url) throw new Error(`No ${name} CSV linked from ${base}`);
    return url;
  };
  return {
    pension: pick(/\/cpp-qpp-ttl-[^/]*\.csv$/i, "CPP/QPP contribution"),
    pension2: pick(/\/cpp-qpp-scnd-addntl-[^/]*\.csv$/i, "CPP2/QPP2"),
    ei: pick(/\/ei-[^/]*\.csv$/i, "Employment Insurance"),
  };
}

type Fetch = (url: string) => Promise<Response>;

async function fetchText(fetchFn: Fetch, url: string): Promise<string> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return await response.text();
}

/**
 * Downloads the current T4127 edition's tables and returns both
 * jurisdictions' figures, effective from that edition's date. Throws when the
 * pages or files can't be read or don't look as expected.
 */
export async function fetchCraPayrollRates(
  fetchFn: Fetch = (url) => fetch(url, { cache: "no-store" }),
): Promise<{ rates: PayrollRates[]; source: string }> {
  const edition = findLatestEdition(await fetchText(fetchFn, T4127_INDEX_URL));
  const links = findCsvLinks(
    await fetchText(fetchFn, edition.url),
    edition.url,
  );
  const [pension, pension2, ei] = await Promise.all([
    fetchText(fetchFn, links.pension),
    fetchText(fetchFn, links.pension2),
    fetchText(fetchFn, links.ei),
  ]);
  return {
    rates: parseCraTables({ pension, pension2, ei }, edition.effectiveFrom),
    source: edition.url,
  };
}
