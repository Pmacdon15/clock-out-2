"use client";

import { PricingTable } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function PlansPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4 py-12 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-4">
            Simple, Transparent Pricing.
          </h1>
          <p className="text-xl text-zinc-500 dark:text-zinc-400 max-w-2xl mx-auto">
            Choose the plan that's right for your team's workflow. All plans
            include our core time tracking features.
          </p>
        </div>

        <div className=" gap-8">
          <PricingTable for="organization" />
          <div className="mt-20 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <p>
              Questions? Contact us at{" "}
              <span className="underline cursor-pointer">
                patrick@patmac.ca
              </span>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
