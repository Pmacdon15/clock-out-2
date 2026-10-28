import { auth } from "@clerk/nextjs/server";
import { verifyMcpToken } from "@/mcp/auth";
import { bearerToken, publicOrigin } from "@/mcp/http";
import {
  exportTimesheetInputSchema,
  generateTimesheetExport,
} from "@/mcp/tools";

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  let userId = session.userId;

  if (!userId) {
    const token = bearerToken(req);
    const authInfo = token ? await verifyMcpToken(req, token) : undefined;
    if (typeof authInfo?.extra?.userId === "string") {
      userId = authInfo.extra.userId;
    }
  }

  if (!userId) {
    const acceptsHtml = (req.headers.get("accept") ?? "")
      .toLowerCase()
      .includes("text/html");
    if (acceptsHtml) {
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

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = exportTimesheetInputSchema.safeParse(params);

  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_parameters",
        error_description: "Invalid timesheet export query parameters.",
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
