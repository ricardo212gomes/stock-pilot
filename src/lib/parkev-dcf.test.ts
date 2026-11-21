import { describe, expect, it } from "vitest";
import type { AnnualFinancialSummary, CompanyProfile } from "./fmp";
import {
  betaScenarios,
  buildParkevDefaults,
  DEFAULT_TIMING,
  equityBridge,
  PARKEV_YEARS,
  valueParkev,
  type ParkevAssumptions,
  type ParkevSheet,
  type ParkevValuation,
} from "./parkev-dcf";

// His sheets show the cash flows in billions, to 4 decimals or to the cent, and the rest in full.
const billions4 = (value: number | null) => `$${(value! / 1e9).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
const billions2 = (value: number | null) => `$${(value! / 1e9).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars = (value: number | null) => `$${Math.round(value!).toLocaleString("en-US")}`;
const count = (value: number | null) => Math.round(value!).toLocaleString("en-US");
const cents = (value: number | null) => `$${value!.toFixed(2)}`;
const percent = (value: number | null) => `${(value! * 100).toFixed(2)}%`;

const B = 1e9;

// Typed estimates by fiscal year, in billions; the other years grow.
function estimates(baseYear: number, typed: Record<number, number>): (number | null)[] {
  return Array.from({ length: PARKEV_YEARS }, (_, index) => {
    const value = typed[baseYear + index + 1];
    return value === undefined ? null : value * B;
  });
}

function value(sheet: ParkevSheet): ParkevValuation {
  const result = valueParkev(sheet);
  if (!result.ok) throw new Error(result.reason);
  return result.valuation;
}

function byYear(valuation: ParkevValuation, pick: (year: ParkevValuation["years"][number]) => number | null, format: (value: number | null) => string) {
  return Object.fromEntries(valuation.years.filter((year) => pick(year) !== null).map((year) => [year.year, format(pick(year))]));
}

const NETFLIX_ASSUMPTIONS: ParkevAssumptions = {
  shortTermGrowth: 0.325,
  transitionGrowth: 0.1625,
  longTermGrowth: 0.05,
  beta: 1.25,
  riskFreeRate: 0.05,
  marketRiskPremium: 0.06,
  costOfDebt: 0.0575,
  debtWeight: 0.25,
};

// "Why Is Netflix Stock Crashing, and is it a Generational Buying Opportunity?": 2026–2029 typed, 2025 and
// 2030 on grown.
const netflix = (marketCap: number, price: number): ParkevSheet => ({
  baseYear: 2024,
  baseFcf: 7.125 * B,
  assumptions: NETFLIX_ASSUMPTIONS,
  estimates: estimates(2024, { 2026: 12.5, 2027: 13.5, 2028: 15.87, 2029: 18.17 }),
  timing: DEFAULT_TIMING,
  nonOperatingAssets: 12_222_400_000,
  debt: 15_000_000_000,
  marketCap,
  price,
});

describe("valueParkev reproduces his sheets", () => {
  it("Netflix, as in the video", () => {
    const valuation = value(netflix(244_346_873_511, 59.39));
    expect(valuation.capm).toBeCloseTo(0.125, 10);
    expect(valuation.wacc.toFixed(4)).toBe("0.1081");
    expect(valuation.equityWeight).toBe(0.75);
    expect(byYear(valuation, (year) => year.fcf, billions4)).toMatchObject({ 2025: "$9.4406", 2026: "$12.5000" });
    expect(byYear(valuation, (year) => year.fcf, billions2)).toMatchObject({ 2027: "$13.50", 2028: "$15.87", 2029: "$18.17", 2030: "$21.12" });
    // 2025 is the year in progress: not counted.
    expect(valuation.years[0].counted).toBe(false);
    expect(billions4(valuation.years[1].presentValue)).toBe("$11.2803");
    expect(byYear(valuation, (year) => year.presentValue, billions2)).toMatchObject({ 2027: "$10.99", 2028: "$11.66", 2029: "$12.05", 2030: "$12.64" });
    expect(billions4(valuation.presentValueOfYears)).toBe("$115.7111");
    expect(billions4(valuation.presentValueOfTerminal)).toBe("$291.1667");
    expect(billions4(valuation.valueOfOperations)).toBe("$406.8778");
    expect(dollars(valuation.valueOfOperations)).toBe("$406,877,786,701");
    expect(dollars(valuation.valueOfEquity)).toBe("$404,100,186,701");
    expect(count(valuation.shares)).toBe("4,114,276,368");
    expect(cents(valuation.valuePerShare)).toBe("$98.22");
    expect(percent(valuation.upside)).toBe("65.38%");
  });

  it("Netflix, later on his sheet, at a lower price", () => {
    const valuation = value(netflix(232_951_815_370, 56.73));
    expect(dollars(valuation.valueOfEquity)).toBe("$404,100,186,701");
    expect(count(valuation.shares)).toBe("4,106,324,967");
    expect(cents(valuation.valuePerShare)).toBe("$98.41");
    expect(percent(valuation.upside)).toBe("73.47%");
  });

  it("Nvidia: counted from 2027 at 1.5 years, the terminal value at 7.5", () => {
    const valuation = value({
      baseYear: 2024,
      baseFcf: 46.79 * B,
      // His short-term growth cell is blank: every year it would apply to is typed.
      assumptions: { shortTermGrowth: 0, transitionGrowth: 0.35, longTermGrowth: 0.05, beta: 2.5, riskFreeRate: 0.05, marketRiskPremium: 0.06, costOfDebt: 0.0575, debtWeight: 0.25 },
      estimates: estimates(2024, { 2025: 64.58, 2026: 96.05, 2027: 200, 2028: 315, 2029: 400, 2030: 420 }),
      timing: { firstCounted: 3, firstYears: 1.5, terminalYears: 7.5 },
      nonOperatingAssets: 140_000_000_000,
      debt: 32_461_000_000,
      marketCap: 3_025_272_970_581,
      price: 125.53,
    });
    expect(valuation.capm).toBeCloseTo(0.2, 10);
    expect(valuation.wacc.toFixed(4)).toBe("0.1644");
    expect(byYear(valuation, (year) => year.presentValue, billions2)).toEqual({
      2027: "$159.18", 2028: "$215.32", 2029: "$234.82", 2030: "$211.75", 2031: "$245.51", 2032: "$284.65", 2033: "$330.03", 2034: "$382.64",
    });
    expect(billions4(valuation.presentValueOfYears)).toBe("$2,063.9092");
    expect(billions4(valuation.presentValueOfTerminal)).toBe("$4,090.2138");
    expect(dollars(valuation.valueOfOperations)).toBe("$6,154,123,019,313");
    expect(dollars(valuation.valueOfEquity)).toBe("$6,261,662,019,313");
    expect(count(valuation.shares)).toBe("24,099,999,766");
    expect(cents(valuation.valuePerShare)).toBe("$259.82");
    expect(percent(valuation.upside)).toBe("106.98%");
  });

  // The sheet with the beta scenarios: nothing reported for 2024, 2026–2030 typed, the terminal value at 8.25 years.
  const scenarioSheet: ParkevSheet = {
    baseYear: 2024,
    baseFcf: 0,
    assumptions: { shortTermGrowth: 1.25, transitionGrowth: 0.1, longTermGrowth: 0.03, beta: 2.47, riskFreeRate: 0.057, marketRiskPremium: 0.07, costOfDebt: 0.08, debtWeight: 0.1 },
    estimates: estimates(2024, { 2026: 131.2, 2027: 232.7, 2028: 272.6, 2029: 273.94, 2030: 354.63 }),
    timing: { firstCounted: 2, firstYears: 1, terminalYears: 8.25 },
    nonOperatingAssets: 149_000_000_000,
    debt: 9_000_000_000,
    marketCap: 864_000_000_000,
    price: 120.37,
  };

  it("the sheet with the scenario analysis", () => {
    const valuation = value(scenarioSheet);
    expect(valuation.capm.toFixed(3)).toBe("0.230");
    expect(valuation.wacc.toFixed(4)).toBe("0.2149");
    expect(byYear(valuation, (year) => year.fcf, billions4)).toMatchObject({ 2025: "$0.0000", 2031: "$390.0930", 2032: "$429.1023" });
    expect(byYear(valuation, (year) => year.presentValue, billions4)).toMatchObject({
      2026: "$107.9915", 2027: "$157.6552", 2028: "$152.0175", 2029: "$125.7416", 2030: "$133.9846", 2031: "$121.3119", 2032: "$109.8379",
    });
    expect(billions4(valuation.presentValueOfYears)).toBe("$1,098.0321");
    expect(billions4(valuation.presentValueOfTerminal)).toBe("$580.4090");
    expect(dollars(valuation.valueOfOperations)).toBe("$1,678,441,138,414");
    expect(dollars(valuation.valueOfEquity)).toBe("$1,818,441,138,414");
    expect(count(valuation.shares)).toBe("7,177,868,240");
    expect(cents(valuation.valuePerShare)).toBe("$253.34");
    expect(percent(valuation.upside)).toBe("110.47%");
  });

  it("his scenario analysis moves beta by +25%, +50% and −25%", () => {
    const scenarios = betaScenarios(scenarioSheet);
    expect(scenarios.map(({ label, beta }) => [label, beta.toFixed(2)])).toEqual([
      ["Plus 25% beta", "3.09"],
      ["Plus 50% beta", "3.71"],
      ["Minus 25% beta", "1.85"],
    ]);
    // A higher beta raises the discount rate, so the value falls.
    const values = scenarios.map(({ result }) => (result.ok ? result.valuation.valuePerShare! : NaN));
    expect(values[0]).toBeLessThan(253.34);
    expect(values[1]).toBeLessThan(values[0]);
    expect(values[2]).toBeGreaterThan(253.34);
  });

  it("CoreWeave's value of operations to the value per share", () => {
    const bridge = equityBridge({
      valueOfOperations: 98_042_813_450,
      nonOperatingAssets: 6_152_883_000,
      debt: 52_562_481_000,
      marketCap: 549_592_822 * 61.86,
      price: 61.86,
    });
    expect(dollars(bridge.valueOfEquity)).toBe("$51,633,215,450");
    expect(count(bridge.shares)).toBe("549,592,822");
    expect(cents(bridge.valuePerShare)).toBe("$93.95");
    expect(percent(bridge.upside)).toBe("51.87%");
  });
});

describe("valueParkev", () => {
  const sheet = netflix(244_346_873_511, 59.39);

  it("grows years 1–5 at the short-term rate and 6–10 at the transition rate when nothing is typed", () => {
    const valuation = value({ ...sheet, estimates: Array(PARKEV_YEARS).fill(null) });
    expect(valuation.years.map((year) => year.source)).toEqual([...Array(5).fill("short"), ...Array(5).fill("transition")]);
    expect(valuation.years[4].fcf).toBeCloseTo(7.125 * B * 1.325 ** 5, 0);
    expect(valuation.years[9].fcf).toBeCloseTo(7.125 * B * 1.325 ** 5 * 1.1625 ** 5, 0);
    expect(valuation.years.map((year) => year.year)).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]);
  });

  it("gives typed years the growth they imply", () => {
    const valuation = value(sheet);
    expect(valuation.years[1].source).toBe("typed");
    expect(valuation.years[1].growth).toBeCloseTo(12.5 / 9.440625 - 1, 10);
    expect(valuation.years[5].growth).toBe(0.1625);
  });

  it("starts from the first typed year without a reported cash flow", () => {
    const result = valueParkev({ ...sheet, baseFcf: null, estimates: estimates(2024, { 2025: 9 }) });
    expect(result.ok).toBe(true);
    expect(valueParkev({ ...sheet, baseFcf: null }).ok).toBe(false);
  });

  it("needs a WACC above the long-term growth", () => {
    const result = valueParkev({ ...sheet, assumptions: { ...NETFLIX_ASSUMPTIONS, longTermGrowth: 0.2 } });
    expect(result).toEqual({ ok: false, reason: "The WACC (10.81%) has to be above the long-term growth (20%), or the terminal value has no end." });
  });

  it("checks the timing and the debt weight", () => {
    expect(valueParkev({ ...sheet, timing: { ...DEFAULT_TIMING, firstCounted: 11 } }).ok).toBe(false);
    expect(valueParkev({ ...sheet, timing: { ...DEFAULT_TIMING, terminalYears: -1 } }).ok).toBe(false);
    expect(valueParkev({ ...sheet, assumptions: { ...NETFLIX_ASSUMPTIONS, debtWeight: 1.5 } }).ok).toBe(false);
  });

  it("counts every year from the first, a year apart", () => {
    const valuation = value({ ...sheet, timing: { firstCounted: 1, firstYears: 0.5, terminalYears: 9.5 } });
    expect(valuation.years.map((year) => year.years)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
  });

  it("has no value per share without a market cap or a price", () => {
    const valuation = value({ ...sheet, marketCap: null });
    expect(valuation.shares).toBeNull();
    expect(valuation.valuePerShare).toBeNull();
    expect(valuation.upside).toBeNull();
  });
});

describe("buildParkevDefaults", () => {
  const annual = (overrides: Partial<AnnualFinancialSummary> = {}): AnnualFinancialSummary => ({
    date: "2025-12-31", fiscalYear: "2025", period: "FY", currency: "USD",
    revenue: 45e9, revenueGrowth: 0.16, grossProfit: 21e9, grossMargin: 0.47, operatingIncome: 13e9, operatingMargin: 0.29,
    netIncome: 11e9, netMargin: 0.24, eps: 2.5, sharesDiluted: 4.3e9, totalDebt: 14.5e9, cash: 9.3e9, netDebt: 5.2e9,
    equity: 26e9, debtToEquity: 0.56, currentRatio: 1.2, interestCoverage: 18, operatingCashFlow: 9.8e9, freeCashFlow: 9.1e9,
    capitalExpenditure: -0.7e9, stockBasedCompensation: 0.3e9, dividendPerShare: null, dividendYield: null, peRatio: 40,
    psRatio: 9, pfcfRatio: 45, ...overrides,
  });
  const profile = { beta: 1.234, price: 100, marketCap: 430e9, currency: "USD" } as CompanyProfile;

  it("starts from the last report, today's quote and his rates", () => {
    const defaults = buildParkevDefaults({
      financials: [annual()],
      profile,
      riskFreeRate: 0.0412,
      quote: { price: 101, marketCap: 434e9 },
      growth: { rate: 0.15, note: "Analysts' consensus." },
    })!;
    expect(defaults.base).toEqual({ year: 2025, fcf: 9.1e9 });
    expect(defaults.assumptions).toEqual({
      shortTermGrowth: 0.15, transitionGrowth: 0.075, longTermGrowth: 0.03, beta: 1.23, riskFreeRate: 0.0412,
      marketRiskPremium: 0.06, costOfDebt: 0.0575, debtWeight: 0.25,
    });
    expect(defaults.timing).toEqual(DEFAULT_TIMING);
    expect(defaults.estimates).toEqual(Array(PARKEV_YEARS).fill(null));
    expect(defaults).toMatchObject({ nonOperatingAssets: 9.3e9, debt: 14.5e9, marketCap: 434e9, price: 101, currency: "USD" });
  });

  it("falls back to the market's beta, an assumed Treasury yield and the reported share count", () => {
    const defaults = buildParkevDefaults({
      financials: [annual({ cash: null, totalDebt: null })],
      profile: null,
      riskFreeRate: null,
      quote: { price: 10, marketCap: null },
      growth: { rate: 0.05, note: undefined },
    })!;
    expect(defaults.assumptions.beta).toBe(1);
    expect(defaults.assumptions.riskFreeRate).toBe(0.0425);
    expect(defaults.marketCap).toBe(4.3e9 * 10);
    expect(defaults).toMatchObject({ nonOperatingAssets: 0, debt: 0 });
    expect(defaults.notes.nonOperatingAssets).toMatch(/isn't reported/);
  });

  it("needs an annual report", () => {
    expect(buildParkevDefaults({ financials: [], profile, riskFreeRate: null, quote: null, growth: { rate: 0.1, note: undefined } })).toBeNull();
  });
});
