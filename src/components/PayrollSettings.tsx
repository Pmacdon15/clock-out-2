"use client";

import { useMutation } from "@tanstack/react-query";
import { Landmark, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/pay";
import {
  DEFAULT_PROVINCE,
  formatRate,
  isProvinceCode,
  jurisdictionFor,
  type PayrollView,
  PROVINCES,
  type ProvinceCode,
  selectPayrollRates,
} from "@/lib/payroll";
import { updatePayrollSettingsAction } from "@/lib/payroll-actions";
import { Button, Card } from "./ui";

interface PayrollSettingsProps {
  initialData: PayrollView | null;
  /** yyyy-MM-dd; which rates to show as "in effect". Defaults to today. */
  today?: string;
}

/**
 * Optional CPP/QPP and EI deductions on pay estimates. Free for every admin,
 * like pay rates. Quebec uses QPP and Quebec EI rates; every other province
 * and territory uses the federal CPP and EI rates.
 */
export default function PayrollSettings({
  initialData,
  today = new Date().toLocaleDateString("en-CA"),
}: PayrollSettingsProps) {
  const savedEnabled = initialData?.enabled ?? false;
  const savedProvince = initialData?.province ?? DEFAULT_PROVINCE;
  const [saved, setSaved] = useState({
    enabled: savedEnabled,
    province: savedProvince,
  });
  const [enabled, setEnabled] = useState(savedEnabled);
  const [province, setProvince] = useState<ProvinceCode>(savedProvince);

  const { mutate, isPending } = useMutation({
    mutationFn: (next: { enabled: boolean; province: ProvinceCode }) =>
      updatePayrollSettingsAction(next.enabled, next.province),
    onSuccess: (res, next) => {
      if (res.success) {
        setSaved(next);
        toast.success("Payroll settings updated");
      } else {
        toast.error(res.error);
      }
    },
  });

  const jurisdiction = jurisdictionFor(province);
  const rates = selectPayrollRates(
    initialData?.rates ?? [],
    jurisdiction,
    today,
  );
  const pensionName = jurisdiction === "QC" ? "QPP" : "CPP";
  const hasChanged = enabled !== saved.enabled || province !== saved.province;

  return (
    <Card className="p-8" data-testid="payroll-settings">
      <div className="mb-8">
        <h3 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <Landmark className="h-6 w-6" />
          Payroll Deductions (Canada)
        </h3>
        <p className="text-muted-foreground">
          Show estimated CPP/QPP and EI deductions and net pay next to gross
          pay. Rates come from the CRA&apos;s payroll deductions formulas and
          update automatically when a new edition is published. Income tax is
          not included.
        </p>
      </div>

      <div className="space-y-6">
        <label
          className="flex cursor-pointer items-start gap-3"
          htmlFor="payroll-enabled"
        >
          <input
            checked={enabled}
            className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            id="payroll-enabled"
            onChange={(e) => setEnabled(e.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block font-medium">Estimate deductions</span>
            <span className="block text-muted-foreground text-sm">
              Members see their own deductions; admins see everyone&apos;s.
            </span>
          </span>
        </label>

        <div className="space-y-1">
          <label className="font-medium text-sm" htmlFor="payroll-province">
            Province or territory of employment
          </label>
          <select
            className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
            id="payroll-province"
            onChange={(e) => {
              if (isProvinceCode(e.target.value)) setProvince(e.target.value);
            }}
            value={province}
          >
            {PROVINCES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        {rates ? (
          <dl
            className="grid grid-cols-1 gap-3 rounded-xl bg-zinc-50 p-4 text-sm sm:grid-cols-3 dark:bg-zinc-900"
            data-testid="payroll-rates"
          >
            <div>
              <dt className="font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
                {pensionName}
              </dt>
              <dd>
                {formatRate(rates.pension.rate)} up to{" "}
                {formatMoney(rates.pension.ympe)} (max{" "}
                {formatMoney(rates.pension.maxContribution)})
              </dd>
            </div>
            <div>
              <dt className="font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
                {pensionName}2
              </dt>
              <dd>
                {formatRate(rates.pension2.rate)} up to{" "}
                {formatMoney(rates.pension2.yampe)} (max{" "}
                {formatMoney(rates.pension2.maxContribution)})
              </dd>
            </div>
            <div>
              <dt className="font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
                EI
              </dt>
              <dd>
                {formatRate(rates.ei.employeeRate)} up to{" "}
                {formatMoney(rates.ei.maxInsurableEarnings)} (max{" "}
                {formatMoney(rates.ei.maxEmployeePremium)})
              </dd>
            </div>
            <p className="text-muted-foreground text-xs sm:col-span-3">
              In effect since {rates.effectiveFrom}.
            </p>
          </dl>
        ) : (
          <p
            className="text-muted-foreground text-sm"
            data-testid="payroll-no-rates"
          >
            No rates are available for this date yet.
          </p>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          className="h-12 px-8 font-bold"
          disabled={isPending || !hasChanged}
          onClick={() => mutate({ enabled, province })}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Payroll Settings
        </Button>
      </div>
    </Card>
  );
}
