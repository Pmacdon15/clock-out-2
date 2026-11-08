import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

describe("ThemeToggle", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("flips between light and dark mode and remembers the choice", () => {
    render(<ThemeToggle className="extra" />);
    const button = screen.getByRole("button", { name: "Toggle dark mode" });
    expect(button).toHaveClass("extra");

    fireEvent.click(button);
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(button);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
