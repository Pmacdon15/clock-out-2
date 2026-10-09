import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

describe("AlertDialog", () => {
  it("renders every part with merged classes", () => {
    render(
      <AlertDialog open>
        <AlertDialogTrigger>Open</AlertDialogTrigger>
        <AlertDialogContent className="content">
          <AlertDialogHeader className="header">
            <AlertDialogTitle className="title">Title</AlertDialogTitle>
            <AlertDialogDescription className="desc">
              Description
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="footer">
            <AlertDialogCancel className="cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction className="action">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveClass("content", "fixed");
    expect(screen.getByText("Title")).toHaveClass("title", "font-semibold");
    expect(screen.getByText("Description")).toHaveClass("desc", "text-sm");
    expect(screen.getByText("Title").parentElement).toHaveClass(
      "header",
      "flex-col",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "border-zinc-200",
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass(
      "bg-red-500",
    );
    expect(
      screen.getByRole("button", { name: "Cancel" }).parentElement,
    ).toHaveClass("footer");
  });

  it("exports the overlay and portal for custom layouts", () => {
    render(
      <AlertDialog open>
        <AlertDialogPortal>
          <AlertDialogOverlay className="overlay" data-testid="overlay" />
        </AlertDialogPortal>
      </AlertDialog>,
    );
    expect(screen.getByTestId("overlay")).toHaveClass("overlay", "bg-black/80");
  });
});
