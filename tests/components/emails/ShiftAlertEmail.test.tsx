import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import ShiftAlertEmail, {
  ShiftAlertEmail as NamedExport,
} from "@/components/emails/ShiftAlertEmail";

describe("ShiftAlertEmail", () => {
  it("is exported both as default and by name", () => {
    expect(NamedExport).toBe(ShiftAlertEmail);
  });

  it("renders the alert with the app logo, action and preferences links", async () => {
    const html = await render(
      ShiftAlertEmail({
        title: "Still clocked in?",
        body: "You've been clocked in for 10h 5m.",
        actionUrl: "https://clock.test/?defaultTab=time-clock",
        appUrl: "https://clock.test",
      }),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toContain("Still clocked in?");
    expect(doc.body.textContent).toContain(
      "You've been clocked in for 10h 5m.",
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "https://clock.test/icon-192.png",
    );
    const links = Array.from(doc.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toContain("https://clock.test/?defaultTab=time-clock");
    expect(links).toContain("https://clock.test/?defaultTab=notifications");
  });
});
