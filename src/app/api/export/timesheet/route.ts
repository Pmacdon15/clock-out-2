import { auth } from "@clerk/nextjs/server";
import { verifyMcpToken } from "@/mcp/auth";
import { bearerToken, publicOrigin } from "@/mcp/http";
import {
  exportTimesheetInputSchema,
  generateTimesheetExport,
} from "@/mcp/tools";

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  let userId = session.userId ?? null;

  if (!userId) {
    const token = bearerToken(req);
    if (token) {
      const authInfo = await verifyMcpToken(req, token);
      if (typeof authInfo?.extra?.userId === "string") {
        userId = authInfo.extra.userId;
      }
    }
  }

  if (!userId) {
    const acceptsHtml = (req.headers.get("accept") ?? "")
      .toLowerCase()
      .includes("text/html");
    if (acceptsHtml && typeof session.redirectToSignIn === "function") {
      return session.redirectToSignIn({ returnBackUrl: req.url });
    }
    return Response.json(
      {
        error: "unauthorized",
        error_description: "Sign in to Clock Out to download this timesheet.",
      },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const parsed = exportTimesheetInputSchema.safeParse({
    org_id: url.searchParams.get("org_id") ?? undefined,
    member: url.searchParams.get("member") ?? undefined,
    format: url.searchParams.get("format") ?? undefined,
    week_of: url.searchParams.get("week_of") ?? undefined,
    start_date: url.searchParams.get("start_date") ?? undefined,
    end_date: url.searchParams.get("end_date") ?? undefined,
    year: parseOptionalInt(url.searchParams.get("year")),
    month: parseOptionalInt(url.searchParams.get("month")),
    week: parseOptionalInt(url.searchParams.get("week")),
    timezone: url.searchParams.get("timezone") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_parameters",
        error_description: parsed.error.issues
          .map((i) => `${i.path.join(".") || "param"}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  const exported = await generateTimesheetExport(
    { userId, client: "browser-download" },
    parsed.data,
    publicOrigin(req),
  );

  if (!exported.ok) {
    return Response.json(
      {
        error: exported.result.summary,
        ...exported.result.data,
      },
      { status: exported.status },
    );
  }

  const { bytes, fileName, mimeType } = exported.value;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
