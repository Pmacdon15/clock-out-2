"use client";

import { Loader2, PiggyBank, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  type CustomDeduction,
  type CustomDeductionKind,
  describeCustomDeduction,
  MAX_DEDUCTION_NAME_LENGTH,
  MAX_FIXED_DEDUCTION,
  MAX_PERCENT_DEDUCTION,
  validateCustomDeduction,
} from "@/lib/payroll";
import {
  addCustomDeductionAction,
  deleteCustomDeductionAction,
} from "@/lib/payroll-actions";
import { Button, Card } from "./ui";

interface CustomDeductionSettingsProps {
  members: { id: string; name: string }[];
  initialDeductions: CustomDeduction[];
  /** Whether payroll deductions are turned on (these show only then). */
  enabled: boolean;
}

const EVERYONE = "";

const inputClass =
  "h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950";
const labelClass = "text-muted-foreground text-sm";

/**
 * Deductions an admin adds on top of CPP/QPP, EI and income tax: RRSP,
 * union dues, benefits and the like. Each one is a fixed amount per pay
 * week or a percentage of gross pay, for every member or just one, and may
 * come off before income tax is worked out.
 */
export default function CustomDeductionSettings({
  members,
  initialDeductions,
  enabled,
}: CustomDeductionSettingsProps) {
  const ids = {
    name: useId(),
    member: useId(),
    kind: useId(),
    amount: useId(),
    preTax: useId(),
  };
  const [deductions, setDeductions] = useState(initialDeductions);
  const [name, setName] = useState("");
  const [memberId, setMemberId] = useState(EVERYONE);
  const [kind, setKind] = useState<CustomDeductionKind>("fixed");
  const [amount, setAmount] = useState("");
  const [preTax, setPreTax] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const draft = {
    name,
    kind,
    amount: amount.trim() === "" ? Number.NaN : Number(amount),
    preTax,
  };
  const problem = validateCustomDeduction(draft);
  const touched = name.trim() !== "" || amount.trim() !== "";

  const add = async () => {
    setIsAdding(true);
    try {
      const res = await addCustomDeductionAction({
        memberId: memberId === EVERYONE ? null : memberId,
        name: name.trim(),
        kind,
        amount: draft.amount,
        preTax,
      });
      if (res.success) {
        setDeductions((prev) => [...prev, res.data]);
        setName("");
        setAmount("");
        setPreTax(false);
        toast.success(`${res.data.name} added`);
      } else {
        toast.error(res.error);
      }
    } finally {
      setIsAdding(false);
    }
  };

  const remove = async (deduction: CustomDeduction) => {
    setRemovingId(deduction.id);
    try {
      const res = await deleteCustomDeductionAction(deduction.id);
      if (res.success) {
        setDeductions((prev) => prev.filter((d) => d.id !== deduction.id));
        toast.success(`${deduction.name} removed`);
      } else {
        toast.error(res.error);
      }
    } finally {
      setRemovingId(null);
    }
  };

  const whoFor = (userId: string | null) =>
    userId === null
      ? "Everyone"
      : (members.find((m) => m.id === userId)?.name ?? "Former member");

  return (
    <Card className="p-8" data-testid="custom-deduction-settings">
      <div className="mb-8">
        <h3 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <PiggyBank className="h-6 w-6" />
          Other Deductions
        </h3>
        <p className="text-muted-foreground">
          Add deductions such as RRSP, union dues or benefits. Each one takes a
          fixed amount per pay week or a percentage of gross pay off net pay,
          for everyone or one member. Mark it before tax when it lowers taxable
          income, as RRSP contributions do.
        </p>
        {!enabled && (
          <p
            className="mt-2 text-muted-foreground text-sm"
            data-testid="custom-deductions-disabled"
          >
            Turn on payroll deductions above to show these on pay estimates.
          </p>
        )}
      </div>

      {deductions.length > 0 ? (
        <ul className="mb-6 space-y-2" data-testid="custom-deduction-list">
          {deductions.map((deduction) => (
            <li
              className="flex items-center justify-between gap-3 rounded-xl border-2 border-zinc-100 p-3 dark:border-zinc-900"
              data-testid={`custom-deduction-${deduction.id}`}
              key={deduction.id}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{deduction.name}</div>
                <div className="text-muted-foreground text-sm">
                  {describeCustomDeduction(deduction)} ·{" "}
                  {whoFor(deduction.userId)}
                </div>
              </div>
              <Button
                aria-label={`Remove ${deduction.name}`}
                className="h-10 w-10 shrink-0 p-0"
                disabled={removingId === deduction.id}
                onClick={() => remove(deduction)}
                variant="outline"
              >
                {removingId === deduction.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-muted-foreground text-sm">
          No other deductions yet.
        </p>
      )}

      <div className="space-y-3 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={labelClass} htmlFor={ids.name}>
              Name
            </label>
            <input
              className={inputClass}
              id={ids.name}
              maxLength={MAX_DEDUCTION_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="RRSP"
              value={name}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor={ids.member}>
              Applies to
            </label>
            <select
              className={inputClass}
              id={ids.member}
              onChange={(e) => setMemberId(e.target.value)}
              value={memberId}
            >
              <option value={EVERYONE}>Everyone</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor={ids.kind}>
              Type
            </label>
            <select
              className={inputClass}
              id={ids.kind}
              onChange={(e) =>
                setKind(e.target.value === "percent" ? "percent" : "fixed")
              }
              value={kind}
            >
              <option value="fixed">Fixed $ per week</option>
              <option value="percent">% of gross pay</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor={ids.amount}>
              {kind === "percent" ? "Percent (%)" : "Amount ($)"}
            </label>
            <input
              className={inputClass}
              id={ids.amount}
              inputMode="decimal"
              max={
                kind === "percent" ? MAX_PERCENT_DEDUCTION : MAX_FIXED_DEDUCTION
              }
              min={0}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={kind === "percent" ? "5" : "25.00"}
              step={0.01}
              type="number"
              value={amount}
            />
          </div>
        </div>
        <label
          className="flex cursor-pointer items-start gap-3"
          htmlFor={ids.preTax}
        >
          <input
            checked={preTax}
            className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            id={ids.preTax}
            onChange={(e) => setPreTax(e.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block font-medium">Before tax</span>
            <span className="block text-muted-foreground text-sm">
              Lowers taxable income, so less income tax is withheld (RRSP, union
              dues). CPP/QPP and EI are unchanged.
            </span>
          </span>
        </label>
        {touched && problem && (
          <p className="text-red-600 text-sm dark:text-red-400">{problem}</p>
        )}
        <div className="flex justify-end">
          <Button
            className="h-11 px-6 font-bold"
            disabled={isAdding || problem !== null}
            onClick={add}
          >
            {isAdding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add Deduction
          </Button>
        </div>
      </div>
    </Card>
  );
}
