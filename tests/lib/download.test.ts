import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toPng } = vi.hoisted(() => ({ toPng: vi.fn() }));
vi.mock("html-to-image", () => ({ toPng }));

import { downloadElementAsImage } from "@/lib/download";

describe("downloadElementAsImage", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it("renders the element to a PNG and clicks a download link", async () => {
    toPng.mockResolvedValue("data:image/png;base64,abc");
    const element = document.createElement("div");
    const createSpy = vi.spyOn(document, "createElement");

    const promise = downloadElementAsImage(element, "my-report");
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(toPng).toHaveBeenCalledWith(element, {
      backgroundColor: "#ffffff",
      pixelRatio: 3,
    });
    const link = createSpy.mock.results.at(-1)?.value as HTMLAnchorElement;
    expect(link.download).toBe("my-report.png");
    expect(link.href).toBe("data:image/png;base64,abc");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    createSpy.mockRestore();
  });

  it("logs and swallows errors from the image renderer", async () => {
    const error = new Error("boom");
    toPng.mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const promise = downloadElementAsImage(document.createElement("div"), "x");
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith("Error downloading graph:", error);
    expect(clickSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
