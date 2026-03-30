"use client";

import { Check, ArrowLeft, Zap, Users, Globe } from "lucide-react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";

const tiers = [
  {
    name: "Starter",
    price: "$0",
    description: "Perfect for freelancers and solo professionals.",
    features: [
      "Individual time tracking",
      "Weekly summary reports",
      "Mobile accessibility",
      "Basic CSV export",
    ],
    cta: "Current Plan",
    variant: "outline" as const,
    icon: Zap,
  },
  {
    name: "Pro (Team)",
    price: "$12",
    period: "/user/mo",
    description: "Ideal for growing teams needing shared insights.",
    features: [
      "Admin dashboard access",
      "Team member management",
      "In-depth monthly analytics",
      "Automated PDF reports",
      "Shared organization workspace",
      "Priority email support",
    ],
    cta: "Upgrade to Pro",
    variant: "default" as const,
    featured: true,
    icon: Users,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "Advanced security and scale for large organizations.",
    features: [
      "Custom role permissions",
      "SSO & SAML integration",
      "Dedicated account manager",
      "API access & webhooks",
      "Unlimited data retention",
      "Training & onboarding",
    ],
    cta: "Contact Sales",
    variant: "outline" as const,
    icon: Globe,
  },
];

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
            Choose the plan that's right for your team's workflow. 
            All plans include our core time tracking features.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={`relative flex flex-col p-8 transition-all hover:scale-[1.02] ${
                tier.featured
                  ? "border-zinc-900 dark:border-zinc-50 ring-1 ring-zinc-900 dark:ring-zinc-50 shadow-xl"
                  : ""
              }`}
            >
              {tier.featured && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-950 text-[10px] font-black uppercase tracking-widest rounded-full">
                  Most Popular
                </div>
              )}

              <div className="mb-8">
                <div className="h-12 w-12 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-6">
                  <tier.icon className="h-6 w-6" />
                </div>
                <h3 className="text-2xl font-bold mb-2">{tier.name}</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black tracking-tighter">
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-zinc-400 font-medium text-sm">
                      {tier.period}
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500 mt-4 leading-relaxed">
                  {tier.description}
                </p>
              </div>

              <div className="flex-1 space-y-4 mb-8">
                {tier.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-3 text-sm">
                    <div className="mt-1 h-4 w-4 rounded-full bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center flex-shrink-0">
                      <Check className="h-2.5 w-2.5 text-white dark:text-zinc-950" />
                    </div>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <Button
                variant={tier.variant}
                className="w-full py-6 text-md font-bold rounded-xl"
              >
                {tier.cta}
              </Button>
            </Card>
          ))}
        </div>

        <div className="mt-20 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <p>
            Questions? Contact us at{" "}
            <span className="underline cursor-pointer">support@clockout.com</span>
          </p>
        </div>
      </div>
    </main>
  );
}
