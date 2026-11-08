import { SignInButton } from "@clerk/nextjs";
import MainPageHeader from "@/components/headers/main-page-header";
import InstallPrompt from "@/components/InstallPrompt";
import McpConnectCard from "@/components/McpConnectCard";

/**
 * The signed-out home page. The proxy rewrites `/` here for visitors without
 * a session, so it reads nothing from the request and is fully static.
 */
export default function WelcomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-4 sm:px-4 sm:py-8">
      <MainPageHeader />
      <InstallPrompt />
      <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
        <h2 className="mb-4 font-extrabold text-4xl tracking-tight">
          Time tracking, simplified.
        </h2>
        <p className="mb-8 max-w-lg text-muted-foreground text-xl">
          Clock in, clock out, and manage your hours with ease. Built for teams
          that value simplicity and precision.
        </p>
        <SignInButton>
          <button
            className="rounded-xl bg-blue-600 px-8 py-4 font-semibold text-lg text-zinc-50 transition-all hover:bg-blue-700 active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            type="button"
          >
            Get Started Now
          </button>
        </SignInButton>
      </div>
      <McpConnectCard />
    </main>
  );
}
