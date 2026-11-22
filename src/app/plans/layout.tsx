import type { Metadata } from "next";

// The plans page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for Clock Out. Every plan includes core time tracking for your team.",
  alternates: { canonical: "/plans" },
};

export default function PlansLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
