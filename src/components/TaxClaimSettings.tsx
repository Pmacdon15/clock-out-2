"use client";

import { FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  isValidAdditionalTax,
  isValidClaimAmount,
  MAX_ADDITIONAL_TAX,
  MAX_CLAIM_AMOUNT,
  type TaxClaims,
} from "@/lib/income-tax";
import type { ProvinceCode } from "@/lib/payroll";
import { updateMemberTaxClaimsAction } from "@/lib/payroll-actions";
import { Button, Card } from "./ui";

interface TaxClaimSettingsProps {
  members: { id: string; name: string }[];
  initialClaims: TaxClaims[];
  province: ProvinceCode;
  /** Whether payroll deductions are turned on (income tax shows only then). */
  enabled: boolean;
}

type Draft = { federal: string; provincial: string; additional: string };

const text = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const toDraft = (saved: TaxClaims | undefined): Draft => ({
  federal: text(saved?.federalClaim),
  provincial: text(saved?.provincialClaim),
  additional: saved?.additionalTax ? String(saved.additionalTax) : "",
});

/** "" means not entered (null); anything else is read as a number. */
const amount = (value: string) => (value.trim() === "" ? null : Number(value));

const inputClass =
  "h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950";

function MemberTaxClaimRow({
  member,
  saved,
  showProvincial,
}: {
  member: { id: string; name: string };
  saved: TaxClaims | undefined;
  showProvincial: boolean;
}) {
  const [current, setCurrent] = useState(() => toDraft(saved));
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [isPending, setIsPending] = useState(false);

  const federalClaim = amount(draft.federal);
  const provincialClaim = amount(draft.provincial);
  const additionalTax = amount(draft.additional) ?? 0;
  const invalid =
    !isValidClaimAmount(federalClaim) ||
    !isValidClaimAmount(provincialClaim) ||
    !isValidAdditionalTax(additionalTax);
  const hasChanged =
    draft.federal !== current.federal ||
    draft.provincial !== current.provincial ||
    draft.additional !== current.additional;

  const save = async () => {
    setIsPending(true);
    try {
      const res = await updateMemberTaxClaimsAction(
        member.id,
        federalClaim,
        provincialClaim,
        additionalTax,
      );
      if (res.success) {
        setCurrent(draft);
        toast.success(`TD1 amounts saved for ${member.name}`);
      } else {
        toast.error(res.error);
      }
    } finally {
      setIsPending(false);
    }
  };

  const update = (key: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <li
      className="space-y-2 rounded-xl border-2 border-zinc-100 p-4 dark:border-zinc-900"
      data-testid={`tax-claim-row-${member.id}`}
    >
      <div className="font-medium">{member.name}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label
            className="text-muted-foreground text-sm"
            htmlFor={`td1-federal-${member.id}`}
          >
            Federal TD1 total ($)
          </label>
          <input
            className={inputClass}
            id={`td1-federal-${member.id}`}
            inputMode="decimal"
            max={MAX_CLAIM_AMOUNT}
            min={0}
            onChange={update("federal")}
            placeholder="Basic amount"
            step={1}
            type="number"
            value={draft.federal}
          />
        </div>
        {showProvincial ? (
          <div className="space-y-1">
            <label
              className="text-muted-foreground text-sm"
              htmlFor={`td1-provincial-${member.id}`}
            >
              Provincial TD1 total ($)
            </label>
            <input
              className={inputClass}
              id={`td1-provincial-${member.id}`}
              inputMode="decimal"
              max={MAX_CLAIM_AMOUNT}
              min={0}
              onChange={update("provincial")}
              placeholder="Basic amount"
              step={1}
              type="number"
              value={draft.provincial}
            />
          </div>
        ) : (
          <div />
        )}
        <div className="space-y-1">
          <label
            className="text-muted-foreground text-sm"
            htmlFor={`td1-additional-${member.id}`}
          >
            Extra tax per pay ($)
          </label>
          <input
            className={inputClass}
            id={`td1-additional-${member.id}`}
            inputMode="decimal"
            max={MAX_ADDITIONAL_TAX}
            min={0}
            onChange={update("additional")}
            placeholder="0"
            step={0.01}
            type="number"
            value={draft.additional}
          />
        </div>
        <Button
          className="h-11 px-6 font-bold"
          disabled={isPending || !hasChanged || invalid}
          onClick={save}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
      {invalid && (
        <p className="text-red-600 text-sm dark:text-red-400">
          Enter claim amounts from 0 to {MAX_CLAIM_AMOUNT.toLocaleString()} and
          extra tax from 0 to {MAX_ADDITIONAL_TAX.toLocaleString()}, or leave
          them blank.
        </p>
      )}
    </li>
  );
}

/**
 * Each member's TD1 figures, so income tax estimates match what their
 * employer would withhold. Blank claim amounts fall back to the basic
 * personal amounts (claim code 1).
 */
export default function TaxClaimSettings({
  members,
  initialClaims,
  province,
  enabled,
}: TaxClaimSettingsProps) {
  const showProvincial = province !== "QC";
  return (
    <Card className="p-8" data-testid="tax-claim-settings">
      <div className="mb-8">
        <h3 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <FileText className="h-6 w-6" />
          Income Tax (TD1)
        </h3>
        <p className="text-muted-foreground">
          Income tax withheld depends on what each employee claims on their TD1
          forms. Enter the total claim amount from each form to match it; leave
          it blank to estimate with the basic personal amount. Members only ever
          see their own figures.
          {!showProvincial &&
            " Quebec provincial tax (TP-1015.3) isn't estimated."}
        </p>
        {!enabled && (
          <p
            className="mt-2 text-muted-foreground text-sm"
            data-testid="tax-claims-disabled"
          >
            Turn on payroll deductions above to show income tax estimates.
          </p>
        )}
      </div>
      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members to show yet.</p>
      ) : (
        <ul className="space-y-3">
          {members.map((member) => (
            <MemberTaxClaimRow
              key={member.id}
              member={member}
              saved={initialClaims.find((row) => row.userId === member.id)}
              showProvincial={showProvincial}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
