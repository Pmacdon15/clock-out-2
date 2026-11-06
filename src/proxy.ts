import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { legacyTabRedirect, SIGNED_IN_ROUTES } from "@/lib/routes";

const isSignedInRoute = createRouteMatcher(
  SIGNED_IN_ROUTES.map((path) => `${path}(.*)`),
);

export const proxy = clerkMiddleware(async (auth, req) => {
  const url = new URL(req.url);

  // Links sent before the tabs became pages: /?defaultTab=view → /hours.
  const legacy = legacyTabRedirect(url);
  if (legacy) return NextResponse.redirect(legacy);

  if (isSignedInRoute(req)) {
    await auth.protect();
    return;
  }

  // `/` is the Time Clock for members and the pitch for everyone else. Both
  // pages are prerendered; the proxy picks one, so neither reads the session
  // while rendering its shell.
  if (url.pathname === "/") {
    const { userId } = await auth();
    if (!userId) return NextResponse.rewrite(new URL("/welcome", url));
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|pptx?)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
