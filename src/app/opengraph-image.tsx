import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const alt = "Clock Out — simple time tracking for teams";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The social share card for every page that doesn't define its own. */
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "#09090b",
        color: "#fafafa",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: "-0.04em" }}>
        {SITE_NAME}
      </div>
      <div style={{ marginTop: 24, fontSize: 44, color: "#a1a1aa" }}>
        Time tracking, simplified.
      </div>
      <div style={{ marginTop: 48, fontSize: 30, color: "#60a5fa" }}>
        Clock in · Breaks · Overtime · Schedules · Timesheets
      </div>
    </div>,
    size,
  );
}
