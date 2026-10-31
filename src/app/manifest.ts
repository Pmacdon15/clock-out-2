import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clock Out | Simple Time Tracking",
    short_name: "Clock Out",
    description: "Clean and efficient time tracking for your organization.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
    shortcuts: [
      {
        name: "Clock In / Clock Out",
        short_name: "Punch Clock",
        description: "Open the time clock directly",
        url: "/?defaultTab=time-clock",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "View Hours",
        short_name: "Hours",
        description: "View logged shifts and hours",
        url: "/?defaultTab=view",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
    categories: ["business", "productivity", "utilities"],
  };
}
