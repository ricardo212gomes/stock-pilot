"use client";

import { useState, type ReactNode } from "react";
import type { ParkevYear, ProjectedYear } from "@/lib/parkev-dcf";
import { formatCell, toneOf } from "./projection-cells";

// The free cash flow table and the beta scenarios of Parkev DCF, laid out like his sheet: amounts in billions (or
// millions for smaller companies), one column per fiscal year.

export type Scale = 1e9 | 1e6;

export function scaleWord(scale: Scale): string {
  return scale === 1e9 ? "billions" : "millions";
}

function scaled(value: number, scale: Scale, digits = 2): string {
  return (value / scale).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// What a box shows: up to 4 decimals in billions, as on his sheet, and 2 in millions.
function boxText(value: number | null, scale: Scale): string {
  return value === null ? "" : String(Number((value / scale).toFixed(scale === 1e9 ? 4 : 2)));
}

// Accepts "12.5", "12,5" (a decimal comma), "-3" and a trailing B or M; an empty box is null. Undefined while
// the text is on its way to a number ("-", ".").
function parseAmount(text: string): number | null | undefined {
  const cleaned = text.trim().replace(/[\s$]/g, "").replace(/[bm]$/i, "");
  if (cleaned === "") return null;
  const normalized = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  if (normalized === "-" || normalized === ".") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// A free cash flow box: shows the grown figure until a figure is typed over it; emptying it grows the year again.
export function AmountCell({
  value,
  typed,
  scale,
  label,
  onChange,
}: {
  value: number | null;
  typed: boolean;
  scale: Scale;
  label: string;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className={`sheet-input parkev-amount${typed ? " parkev-typed" : ""}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? boxText(value, scale)}
        onFocus={(event) => {
          setDraft(typed ? boxText(value, scale) : "");
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = parseAmount(event.target.value);
          if (parsed !== undefined) onChange(parsed === null ? null : parsed * scale);
        }}
        onBlur={() => setDraft(null)}
        placeholder={typed ? undefined : boxText(value, scale)}
      />
      <span aria-hidden="true">{scale === 1e9 ? "B" : "M"}</span>
    </span>
  );
}

const SOURCE_TITLE: Record<ProjectedYear["source"], string> = {
  typed: "Typed: the growth it makes against the year before",
  short: "The short-term growth rate",
  transition: "The transition growth rate",
};

export function FcfTable({
  baseYear,
  baseFcf,
  baseTyped,
  projected,
  valued,
  scale,
  currency,
  onBase,
  onEstimate,
}: {
  baseYear: number;
  baseFcf: number | null;
  // Whether the reported figure was typed over.
  baseTyped: boolean;
  projected: ProjectedYear[];
  // The counted years' discounting, when the inputs give a value.
  valued: ParkevYear[] | null;
  scale: Scale;
  currency: string;
  onBase: (value: number | null) => void;
  onEstimate: (index: number, value: number | null) => void;
}) {
  const cell = (index: number, content: ReactNode, extra = "") => (
    <td key={index} className={`${index === 0 ? "sheet-first-projected " : ""}${extra}`.trim() || undefined}>{content}</td>
  );
  return (
    <div className="table-scroll">
      <table className="financial-table projection-sheet parkev-sheet">
        <caption className="visually-hidden">
          Free cash flow in {scaleWord(scale)} of {currency}: fiscal {baseYear} as reported, then ten forecast years with their
          growth, the years each is discounted by and its present value
        </caption>
        <thead>
          <tr className="sheet-groups">
            <td />
            <th scope="col">Reported</th>
            <th scope="colgroup" colSpan={projected.length} className="sheet-first-projected">Forecast</th>
          </tr>
          <tr>
            <th scope="col">Fiscal year</th>
            <th scope="col" className="sheet-reported">{baseYear}</th>
            {projected.map((year, index) => (
              <th scope="col" key={year.year} className={index === 0 ? "sheet-first-projected" : undefined}>{year.year}e</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="sheet-row-input">
            <th scope="row">Free cash flow</th>
            <td>
              <AmountCell value={baseFcf} typed={baseTyped} scale={scale} label={`Free cash flow, fiscal ${baseYear}, in ${scaleWord(scale)}`} onChange={onBase} />
            </td>
            {projected.map((year, index) => cell(index, (
              <AmountCell
                value={year.fcf}
                typed={year.source === "typed"}
                scale={scale}
                label={`Free cash flow, fiscal ${year.year}, in ${scaleWord(scale)}`}
                onChange={(value) => onEstimate(index, value)}
              />
            )))}
          </tr>
          <tr className="sheet-row-sub">
            <th scope="row">Growth</th>
            <td />
            {projected.map((year, index) => cell(index, (
              <span title={SOURCE_TITLE[year.source]} className={year.source === "typed" ? "parkev-implied" : undefined}>
                {formatCell(year.growth, "percent", currency)}
              </span>
            )))}
          </tr>
          <tr className="sheet-row-sub">
            <th scope="row">Years discounted</th>
            <td />
            {projected.map((year, index) => {
              const counted = valued?.[index];
              return cell(index, counted ? (counted.years === null ? "Not counted" : String(Number(counted.years.toFixed(2)))) : "—", counted && !counted.counted ? "parkev-muted" : "");
            })}
          </tr>
          <tr className="sheet-row-result">
            <th scope="row">Present value</th>
            <td />
            {projected.map((year, index) => {
              const presentValue = valued?.[index]?.presentValue ?? null;
              return cell(index, presentValue === null ? "—" : scaled(presentValue, scale), presentValue === null ? "parkev-muted" : "");
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export type BetaRow = { id: string; label: string; beta: number; wacc: number | null; value: number | null; upside: number | null };

// His scenario analysis: the value per share with beta 25% and 50% higher, and 25% lower.
export function BetaTable({ rows, currency }: { rows: BetaRow[]; currency: string }) {
  return (
    <div className="table-scroll">
      <table className="financial-table parkev-beta-table">
        <caption className="visually-hidden">Intrinsic value per share with a higher and a lower beta</caption>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Beta</th>
            <th scope="col">WACC</th>
            <th scope="col">Value per share</th>
            <th scope="col">Upside</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.id === "inputs" ? "parkev-beta-current" : undefined}>
              <th scope="row">{row.label}</th>
              <td>{row.beta.toFixed(2)}</td>
              <td>{row.wacc === null ? "—" : `${(row.wacc * 100).toFixed(2)}%`}</td>
              <td>{formatCell(row.value, "perShare", currency)}</td>
              <td className={toneOf(row.upside)}>{row.upside === null ? "—" : signedPercent(row.upside)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// +65.38%, as on his sheet (two decimals).
export function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

// Whole currency units, as his sheet shows the value of operations and equity: $406,877,786,701.
export function wholeMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("en-US")} ${currency}`;
  }
}
