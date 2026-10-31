"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker
    ) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.debug("Service worker registration failed:", error);
        }
      });
    }
  }, []);

  return null;
}
