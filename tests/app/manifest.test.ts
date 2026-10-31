import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("Web App Manifest", () => {
  it("provides full PWA manifest configuration", () => {
    const data = manifest();
    expect(data.name).toBe("Clock Out | Simple Time Tracking");
    expect(data.short_name).toBe("Clock Out");
    expect(data.display).toBe("standalone");
    expect(data.start_url).toBe("/");
    expect(data.background_color).toBe("#09090b");
    expect(data.theme_color).toBe("#09090b");
    expect(data.orientation).toBe("portrait-primary");

    expect(data.icons).toBeDefined();
    expect(data.icons?.length).toBeGreaterThanOrEqual(4);

    const sizes = data.icons?.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");

    const maskable = data.icons?.filter((icon) => icon.purpose === "maskable");
    expect(maskable?.length).toBeGreaterThanOrEqual(2);

    expect(data.shortcuts).toEqual([
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
    ]);

    expect(data.categories).toContain("productivity");
  });
});
