import type { AnnualFinancialSummary, CompanyProfile } from "./fmp";
import { FALLBACK_RISK_FREE_RATE } from "./valuation/defaults";

// Parkev Tatevosian's discounted cash flow valuation, as on the Google Sheets in his videos. Free cash flow grows
// from the last reported fiscal year for ten years, the first five at the short-term rate and the last five at the
// transition rate, except where a year's figure is typed over it (he types analysts' estimates). The counted years
// and a terminal value (the last year growing at the long-term rate forever) are discounted at the WACC:
//
//   CAPM = risk-free rate + beta × market risk premium
//   WACC = equity weight × CAPM + debt weight × cost of debt (no tax shield, as on his sheets)
//   value of operations + non-operating assets − debt = value of equity
//   value of equity ÷ shares (market cap ÷ price) = intrinsic value per share
//
// From the same inputs it gives the same figures as his sheets: parkev-dcf.test.ts reproduces his Netflix, Nvidia
// and CoreWeave valuations to the dollar.

export const PARKEV_YEARS = 10;
// Years 1–5 grow at the short-term rate, 6–10 at the transition rate.
export const SHORT_TERM_YEARS = 5;

export type ParkevAssumptions = {
  shortTermGrowth: number;
  transitionGrowth: number;
  longTermGrowth: number;
  beta: number;
  riskFreeRate: number;
  marketRiskPremium: number;
  costOfDebt: number;
  // The equity weight is 1 − this.
  debtWeight: number;
};

export const ASSUMPTION_KEYS = [
  "shortTermGrowth",
  "transitionGrowth",
  "longTermGrowth",
  "beta",
  "riskFreeRate",
  "marketRiskPremium",
  "costOfDebt",
  "debtWeight",
] as const satisfies readonly (keyof ParkevAssumptions)[];

// When the cash flows arrive, in years from now. firstCounted is the first forecast year in the value (1 is the year
// after the last report); each year after it is a year further away. His sheets don't all agree: most count from
// the second forecast year (the one after the year in progress) at 1 year with the terminal value at 8.5, his Nvidia
// sheet from the third at 1.5 years with the terminal value at 7.5, and his CoreWeave one has the terminal value at 8.25.
export type ParkevTiming = { firstCounted: number; firstYears: number; terminalYears: number };

export const DEFAULT_TIMING: ParkevTiming = { firstCounted: 2, firstYears: 1, terminalYears: 8.5 };

export type ParkevSheet = {
  // The last reported fiscal year and its free cash flow, the starting point.
  baseYear: number;
  baseFcf: number | null;
  assumptions: ParkevAssumptions;
  // One per forecast year: the free cash flow typed over that year's growth, or null to grow the year before.
  estimates: (number | null)[];
  timing: ParkevTiming;
  nonOperatingAssets: number;
  debt: number;
  marketCap: number | null;
  price: number | null;
};

export type ProjectedYear = {
  year: number;
  // Null only while there's nothing to grow from: no reported cash flow and no typed years before it.
  fcf: number | null;
  // Typed over, or grown at the short-term or transition rate.
  source: "typed" | "short" | "transition";
  // Against the year before, when that was above zero.
  growth: number | null;
};

// Each forecast year's free cash flow: typed, or the year before grown at its stage's rate.
export function projectCashFlows(sheet: Pick<ParkevSheet, "baseYear" | "baseFcf" | "assumptions" | "estimates">): ProjectedYear[] {
  const years: ProjectedYear[] = [];
  let previous = sheet.baseFcf;
  for (let index = 0; index < PARKEV_YEARS; index++) {
    const typed = sheet.estimates[index] ?? null;
    const source: ProjectedYear["source"] = typed !== null ? "typed" : index < SHORT_TERM_YEARS ? "short" : "transition";
    const rate = source === "short" ? sheet.assumptions.shortTermGrowth : sheet.assumptions.transitionGrowth;
    const fcf = typed ?? (previous === null ? null : previous * (1 + rate));
    years.push({
      year: sheet.baseYear + index + 1,
      fcf,
      source,
      growth: source !== "typed" ? rate : fcf !== null && previous !== null && previous > 0 ? fcf / previous - 1 : null,
    });
    previous = fcf;
  }
  return years;
}

export type ParkevYear = ProjectedYear & {
  fcf: number;
  counted: boolean;
  // Years it's discounted by, and its present value, when it's counted.
  years: number | null;
  presentValue: number | null;
};

export type ParkevBridge = {
  valueOfEquity: number;
  shares: number | null;
  valuePerShare: number | null;
  upside: number | null;
};

export type ParkevValuation = ParkevBridge & {
  capm: number;
  equityWeight: number;
  wacc: number;
  years: ParkevYear[];
  presentValueOfYears: number;
  terminalValue: number;
  presentValueOfTerminal: number;
  valueOfOperations: number;
  // The terminal value's share of the value of operations, when that's above zero.
  terminalShare: number | null;
};

export type ParkevResult = { ok: true; valuation: ParkevValuation } | { ok: false; reason: string };

export function capmRate(assumptions: ParkevAssumptions): number {
  return assumptions.riskFreeRate + assumptions.beta * assumptions.marketRiskPremium;
}

export function waccRate(assumptions: ParkevAssumptions): number {
  return (1 - assumptions.debtWeight) * capmRate(assumptions) + assumptions.debtWeight * assumptions.costOfDebt;
}

function pct(value: number): string {
  return `${Number((value * 100).toFixed(2))}%`;
}

// From the value of operations to the value per share. Shares are market cap ÷ price, as on his sheets.
export function equityBridge({
  valueOfOperations,
  nonOperatingAssets,
  debt,
  marketCap,
  price,
}: {
  valueOfOperations: number;
  nonOperatingAssets: number;
  debt: number;
  marketCap: number | null;
  price: number | null;
}): ParkevBridge {
  const valueOfEquity = valueOfOperations + nonOperatingAssets - debt;
  const shares = marketCap !== null && marketCap > 0 && price !== null && price > 0 ? marketCap / price : null;
  const valuePerShare = shares === null ? null : valueOfEquity / shares;
  const upside = valuePerShare === null || price === null || price <= 0 ? null : valuePerShare / price - 1;
  return { valueOfEquity, shares, valuePerShare, upside };
}

export function valueParkev(sheet: ParkevSheet): ParkevResult {
  const { assumptions, timing } = sheet;
  const { firstCounted, firstYears, terminalYears } = timing;
  if (!Number.isInteger(firstCounted) || firstCounted < 1 || firstCounted > PARKEV_YEARS) {
    return { ok: false, reason: `The first counted year has to be one of the ${PARKEV_YEARS} forecast years.` };
  }
  if (!(firstYears >= 0) || !(terminalYears >= 0)) {
    return { ok: false, reason: "The years until the cash flows can't be below zero." };
  }
  if (!(assumptions.debtWeight >= 0 && assumptions.debtWeight <= 1)) {
    return { ok: false, reason: "The debt weight has to be between 0% and 100%." };
  }
  const projected = projectCashFlows(sheet);
  if (projected.some((year) => year.fcf === null)) {
    return { ok: false, reason: `Needs fiscal ${sheet.baseYear} free cash flow: type it in the table, or type the first year's.` };
  }

  const capm = capmRate(assumptions);
  const wacc = waccRate(assumptions);
  if (wacc <= -1) return { ok: false, reason: "The WACC has to be above −100%." };
  if (wacc <= assumptions.longTermGrowth) {
    return {
      ok: false,
      reason: `The WACC (${pct(wacc)}) has to be above the long-term growth (${pct(assumptions.longTermGrowth)}), or the terminal value has no end.`,
    };
  }

  const years = projected.map((year, index): ParkevYear => {
    const fcf = year.fcf!;
    const counted = index + 1 >= firstCounted;
    const discountYears = counted ? firstYears + (index + 1 - firstCounted) : null;
    return {
      ...year,
      fcf,
      counted,
      years: discountYears,
      presentValue: discountYears === null ? null : fcf / (1 + wacc) ** discountYears,
    };
  });

  const presentValueOfYears = years.reduce((sum, year) => sum + (year.presentValue ?? 0), 0);
  const last = years[years.length - 1].fcf;
  const terminalValue = (last * (1 + assumptions.longTermGrowth)) / (wacc - assumptions.longTermGrowth);
  const presentValueOfTerminal = terminalValue / (1 + wacc) ** terminalYears;
  const valueOfOperations = presentValueOfYears + presentValueOfTerminal;
  const bridge = equityBridge({
    valueOfOperations,
    nonOperatingAssets: sheet.nonOperatingAssets,
    debt: sheet.debt,
    marketCap: sheet.marketCap,
    price: sheet.price,
  });

  return {
    ok: true,
    valuation: {
      capm,
      equityWeight: 1 - assumptions.debtWeight,
      wacc,
      years,
      presentValueOfYears,
      terminalValue,
      presentValueOfTerminal,
      valueOfOperations,
      terminalShare: valueOfOperations > 0 ? presentValueOfTerminal / valueOfOperations : null,
      ...bridge,
    },
  };
}

// His scenario analysis: the same sheet with beta 25% and 50% higher and 25% lower.
export const BETA_SCENARIOS = [
  { id: "plus25", label: "Plus 25% beta", factor: 1.25 },
  { id: "plus50", label: "Plus 50% beta", factor: 1.5 },
  { id: "minus25", label: "Minus 25% beta", factor: 0.75 },
] as const;

export type BetaScenario = { id: string; label: string; beta: number; result: ParkevResult };

export function betaScenarios(sheet: ParkevSheet): BetaScenario[] {
  return BETA_SCENARIOS.map(({ id, label, factor }) => {
    const beta = sheet.assumptions.beta * factor;
    return { id, label, beta, result: valueParkev({ ...sheet, assumptions: { ...sheet.assumptions, beta } }) };
  });
}

// ---- Starting values ----------------------------------------------------------------------------------------------

// The rates his sheets use: a 6% market risk premium, a 5.75% cost of debt, a 25% debt weight (75% equity), and
// long-term growth of 3% to 5% (3% here, the cautious end).
export const PARKEV_RATES = { marketRiskPremium: 0.06, costOfDebt: 0.0575, debtWeight: 0.25, longTermGrowth: 0.03 } as const;

export type ParkevNoteKey = "fcf" | "growth" | "beta" | "riskFreeRate" | "rates" | "nonOperatingAssets" | "debt" | "shares";

export type ParkevDefaults = {
  // The currency of the statements, which the value per share is in.
  currency: string;
  base: { year: number; fcf: number | null };
  assumptions: ParkevAssumptions;
  estimates: (number | null)[];
  timing: ParkevTiming;
  nonOperatingAssets: number;
  debt: number;
  // Today's, from the quote.
  marketCap: number | null;
  price: number | null;
  notes: Record<ParkevNoteKey, string>;
};

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function fiscalYearOf(row: AnnualFinancialSummary): number | null {
  const year = Number(row.fiscalYear);
  if (Number.isInteger(year) && year > 1900) return year;
  const fromDate = Number(row.date.slice(0, 4));
  return Number.isInteger(fromDate) && fromDate > 1900 ? fromDate : null;
}

// From the last annual report, today's quote, FMP's beta, the 10-year Treasury yield and the Intrinsic Value tool's
// growth rate (analysts' consensus where FMP has it); null without an annual report.
export function buildParkevDefaults({
  financials,
  profile,
  riskFreeRate,
  quote,
  growth,
}: {
  // Newest first.
  financials: AnnualFinancialSummary[];
  profile: CompanyProfile | null;
  riskFreeRate: number | null;
  quote: { price: number; marketCap: number | null } | null;
  growth: { rate: number; note: string | undefined };
}): ParkevDefaults | null {
  const latest = financials[0];
  const year = latest ? fiscalYearOf(latest) : null;
  if (!latest || year === null) return null;

  const price = quote?.price ?? profile?.price ?? null;
  const reportedShares = latest.sharesDiluted !== null && latest.sharesDiluted > 0 ? latest.sharesDiluted : null;
  const quotedCap = quote?.marketCap ?? profile?.marketCap ?? null;
  const marketCap = quotedCap ?? (reportedShares !== null && price !== null ? reportedShares * price : null);
  const sharesFrom = quotedCap !== null
    ? "Today's market cap ÷ today's price, as on his sheets."
    : marketCap !== null
      ? `Fiscal ${year}'s diluted shares × today's price, as the market cap isn't available; shares are market cap ÷ price, as on his sheets.`
      : "Needs today's market cap and price: shares are market cap ÷ price, as on his sheets.";

  const fmpBeta = profile?.beta ?? null;
  const beta = fmpBeta !== null && fmpBeta > 0 ? round(fmpBeta, 2) : 1;
  const rf = round(riskFreeRate ?? FALLBACK_RISK_FREE_RATE);
  const shortTermGrowth = round(growth.rate);
  const transitionGrowth = round(shortTermGrowth / 2);
  const fcf = latest.freeCashFlow;

  return {
    currency: latest.currency,
    base: { year, fcf },
    assumptions: {
      shortTermGrowth,
      transitionGrowth,
      longTermGrowth: PARKEV_RATES.longTermGrowth,
      beta,
      riskFreeRate: rf,
      marketRiskPremium: PARKEV_RATES.marketRiskPremium,
      costOfDebt: PARKEV_RATES.costOfDebt,
      debtWeight: PARKEV_RATES.debtWeight,
    },
    estimates: Array.from({ length: PARKEV_YEARS }, () => null),
    timing: DEFAULT_TIMING,
    nonOperatingAssets: latest.cash ?? 0,
    debt: latest.totalDebt ?? 0,
    marketCap,
    price,
    notes: {
      fcf: fcf === null
        ? `Fiscal ${year}'s free cash flow isn't reported: type it in the table.`
        : `Free cash flow reported for fiscal ${year}: operating cash flow less capital spending.${fcf <= 0 ? " It's not above zero, so growing it can't make it positive: type each year's estimate instead, as he does." : ""}`,
      growth: `Short-term: ${growth.note ?? "the Intrinsic Value tool's growth rate."} Transition: half of it, as on his Netflix sheet. Long-term: ${pct(PARKEV_RATES.longTermGrowth)}; his sheets use 3% to 5%.`,
      beta: fmpBeta !== null && fmpBeta > 0
        ? "FMP's beta: how much the stock has moved with the market."
        : "1, the market's: FMP has no beta above zero for this company.",
      riskFreeRate: riskFreeRate !== null ? "Today's 10-year Treasury yield." : `${pct(FALLBACK_RISK_FREE_RATE)}: the Treasury yield isn't available.`,
      rates: "A 6% market risk premium, a 5.75% cost of debt and a 25% debt weight, as on his sheets.",
      nonOperatingAssets: latest.cash !== null
        ? `Cash and short-term investments at the end of fiscal ${year}.`
        : `Fiscal ${year}'s cash isn't reported: type it.`,
      debt: latest.totalDebt !== null ? `Total debt at the end of fiscal ${year}.` : `Fiscal ${year}'s debt isn't reported: type it.`,
      shares: sharesFrom,
    },
  };
}
