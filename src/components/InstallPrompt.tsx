"use client";

import { Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    // Check if already installed / running in standalone mode
    const standalone =
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsStandalone(standalone);

    if (standalone) {
      return;
    }

    let dismissed = false;
    try {
      dismissed = localStorage.getItem("clockout_install_dismissed") === "true";
    } catch {
      // Ignore security error or missing localStorage
    }

    if (dismissed) {
      return;
    }

    setIsDismissed(false);

    // Detect iOS
    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(ua) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setIsDismissed(true);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem("clockout_install_dismissed", "true");
    } catch {
      // LocalStorage might fail in private browsing
    }
  };

  if (isStandalone || isDismissed || (!deferredPrompt && !isIOS)) {
    return null;
  }

  return (
    <section
      aria-label="Install mobile app"
      className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
          <Download className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-50">
            Install Clock Out on your phone
          </p>
          <p className="text-muted-foreground text-xs">
            {isIOS
              ? "Tap the Share button below, then select 'Add to Home Screen' for fast 1-tap punch in."
              : "Add to your home screen for instant 1-tap punch in, even on slow mobile data."}
          </p>
        </div>
      </div>

      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {deferredPrompt && (
          <Button
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={handleInstallClick}
            size="sm"
          >
            <Download className="h-3.5 w-3.5" />
            Install App
          </Button>
        )}
        {isIOS && !deferredPrompt && (
          <span className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 font-medium text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            <Share2 className="h-3 w-3" />
            Share &rarr; Add to Home Screen
          </span>
        )}
        <button
          aria-label="Dismiss install prompt"
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          onClick={handleDismiss}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
