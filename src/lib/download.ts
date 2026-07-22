import { toPng } from "html-to-image";

/**
 * Captures an element as an image and downloads it.
 * This version expects the element to ALREADY be styled correctly for capture
 * (e.g. desktop size, hidden from user if needed).
 */
export async function downloadElementAsImage(
  element: HTMLElement,
  fileName: string,
) {
  const bgColor = "#ffffff";

  try {
    // Wait a tiny bit to ensure Recharts has layouted if it was just rendered
    await new Promise((resolve) => setTimeout(resolve, 100));

    const dataUrl = await toPng(element, {
      backgroundColor: bgColor,
      pixelRatio: 3,
    });

    const link = document.createElement("a");
    link.download = `${fileName}.png`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("Error downloading graph:", error);
  }
}
