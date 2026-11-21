"use client";

import { useState } from "react";

// Units for calculator inputs: amounts in millions, percentages as whole numbers. "years" are whole; "period" is
// years with decimals (1.5), and "number" has no unit (a beta).
export type Unit = "currency" | "millions" | "shares" | "percent" | "multiple" | "years" | "period" | "number";

export function toText(value: number | null, unit: Unit): string {
  if (value === null) return "";
  const shown = unit === "percent" ? value * 100 : unit === "millions" || unit === "shares" ? value / 1e6 : value;
  return String(Number(shown.toFixed(unit === "years" ? 0 : 2)));
}

export function fromText(text: string, unit: Unit): number | null {
  const parsed = Number(text.trim().replace(/,/g, ""));
  if (text.trim() === "" || !Number.isFinite(parsed)) return null;
  return unit === "percent" ? parsed / 100 : unit === "millions" || unit === "shares" ? parsed * 1e6 : parsed;
}

export function NumberInput({
  id,
  label,
  value,
  unit,
  currency,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  unit: Unit;
  currency: string;
  onChange: (value: number | null) => void;
}) {
  // While the box is focused it shows what was typed, so "8." or "-" can be on the way to a number; otherwise it
  // shows the value it was given, which may have come from a draft saved in the browser after the first render.
  const [draft, setDraft] = useState<string | null>(null);
  const suffix = { currency, millions: `M ${currency}`, shares: "M", percent: "%", multiple: "×", years: "yrs", period: "yrs", number: "" }[unit];
  return (
    <div className="assumption-input-wrap">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? toText(value, unit)}
        onFocus={() => setDraft(toText(value, unit))}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(fromText(event.target.value, unit));
        }}
        onBlur={() => setDraft(null)}
      />
      {suffix && <span className="assumption-suffix" aria-hidden="true">{suffix}</span>}
    </div>
  );
}
