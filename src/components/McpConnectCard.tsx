"use client";

import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "./ui";

const DEFAULT_MCP_URL = "https://clockout.patmac.ca/api/mcp";

export default function McpConnectCard() {
  const [copied, setCopied] = useState(false);
  const [mcpUrl, setMcpUrl] = useState(DEFAULT_MCP_URL);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      setMcpUrl(`${window.location.origin}/api/mcp`);
    }
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="mt-10 border-zinc-200/80 p-6 text-left dark:border-zinc-800/80">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 font-medium text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Connect AI (MCP Server)</span>
          </div>
          <h3 className="font-bold text-lg text-zinc-900 tracking-tight dark:text-zinc-50">
            Use Clock Out inside Claude, Gemini, and Muse
          </h3>
          <p className="max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Add this MCP server URL to your AI assistant and sign in with your
            Clock Out account. Clock in or out, check who is working, view
            weekly timecards, or upload a photo of a paper timecard to log
            shifts automatically without double times.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <code
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 font-mono text-xs text-zinc-800 select-all dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
            data-testid="mcp-endpoint-url"
            suppressHydrationWarning
          >
            {mcpUrl}
          </code>
          <button
            aria-label="Copy MCP server URL"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-sm text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            onClick={handleCopy}
            type="button"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                <span>Copy URL</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 border-zinc-200 border-t pt-4 text-xs text-zinc-500 sm:grid-cols-3 dark:border-zinc-800 dark:text-zinc-400">
        <div>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            Clock In & Out:
          </span>{" "}
          Start or stop shifts for yourself—or as an admin, manage any team
          member.
        </div>
        <div>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            Photo Timecards:
          </span>{" "}
          Send a picture of a schedule or timecard to add or update hours with
          zero duplicate shifts.
        </div>
        <div>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            Live Team Status:
          </span>{" "}
          See who is working right now, for how long, and pull weekly timecard
          breakdowns.
        </div>
      </div>
    </Card>
  );
}
