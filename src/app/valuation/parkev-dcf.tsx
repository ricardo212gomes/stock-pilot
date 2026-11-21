"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { NumberInput } from "./calculator-input";
import { BetaTable, FcfTable, scaleWord, signedPercent, wholeMoney, type BetaRow, type Scale } from "./parkev-dcf-parts";
import { formatCell, toneOf } from "./projection-cells";
import { parkevKey, parseSavedParkev, readSaved, subscribeSaved, writeSaved, type SavedParkev } from "./saved-projection";
import { SaveProjection, type ProjectionSnapshot } from "./save-projection";
import { OpenedBanner } from "./saved-banner";
import type { OpenedProjection, SaveStatus } from "./saved-data";
import { valuationTool } from "./tools";
import { restoreParkev, type ParkevInputs } from "@/lib/saved-projection-inputs";
import {
  betaScenarios,
  DEFAULT_TIMING,
  PARKEV_YEARS,
  projectCashFlows,
  SHORT_TERM_YEARS,
  valueParkev,
  type ParkevAssumptions,
  type ParkevDefaults,
  type ParkevSheet,
  type ParkevTiming,
} from "@/lib/parkev-dcf";

type Working = Omit<ParkevInputs, "market">;
type StartField = keyof SavedParkev["start"];

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function Field({ id, label, note, children }: { id: string; label: string; note?: string; children: ReactNode }) {
  return (
    <div className="parkev-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {note && <p className="assumption-short">{note}</p>}
    </div>
  );
}

function Computed({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`parkev-computed${strong ? " parkev-computed-strong" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ParkevDcf({
  symbol,
  defaults,
  market,
  saving,
}: {
  symbol: string;
  defaults: ParkevDefaults;
  market: { changePercent: number | null; yearHigh: number | null; yearLow: number | null };
  saving: { status: SaveStatus; opened: OpenedProjection | null };
}) {
  const { currency, notes } = defaults;
  const key = parkevKey(symbol, defaults.base.year);
  const { opened } = saving;
  const starting: Working = {
    assumptions: defaults.assumptions,
    estimates: defaults.estimates,
    timing: defaults.timing,
    base: { year: defaults.base.year, fcf: defaults.base.fcf, nonOperatingAssets: defaults.nonOperatingAssets, debt: defaults.debt },
  };
  // A saved valuation that's open (?saved=ID) is edited here, apart from the browser draft, until it's saved again.
  const [restored] = useState(() => (opened ? restoreParkev(opened.inputs, starting) : null));
  const [openState, setOpenState] = useState<Working | null>(restored ? { ...restored.inputs } : null);
  // The server renders the starting values; a valuation saved in this browser replaces them.
  const savedText = useSyncExternalStore(subscribeSaved, () => readSaved(key), () => null);
  const draft = useMemo(() => parseSavedParkev(savedText), [savedText]);
  const edits: SavedParkev["start"] = draft?.start ?? { fcf: null, nonOperatingAssets: null, debt: null };
  const working: Working = openState ?? {
    assumptions: draft?.assumptions ?? defaults.assumptions,
    estimates: draft?.estimates ?? defaults.estimates,
    timing: draft?.timing ?? defaults.timing,
    base: {
      year: defaults.base.year,
      fcf: edits.fcf ?? defaults.base.fcf,
      nonOperatingAssets: edits.nonOperatingAssets ?? defaults.nonOperatingAssets,
      debt: edits.debt ?? defaults.debt,
    },
  };
  const baseTyped = openState ? openState.base.fcf !== defaults.base.fcf : edits.fcf !== null;
  // Today's price and market cap, unless typed over: for this visit, or kept by an opened save.
  const [marketEdits, setMarketEdits] = useState<ParkevInputs["market"]>(restored?.inputs.market ?? { marketCap: null, price: null });
  const price = marketEdits.price ?? defaults.price;
  const marketCap = marketEdits.marketCap ?? defaults.marketCap;
  const [version, setVersion] = useState(0);

  const { assumptions, estimates, timing, base } = working;
  const sheet: ParkevSheet = {
    baseYear: base.year,
    baseFcf: base.fcf,
    assumptions,
    estimates,
    timing,
    nonOperatingAssets: base.nonOperatingAssets,
    debt: base.debt,
    marketCap,
    price,
  };
  const result = valueParkev(sheet);
  const valuation = result.ok ? result.valuation : null;
  const reason = result.ok ? null : result.reason;
  const upside = valuation?.upside ?? null;
  const projected = projectCashFlows(sheet);
  const scenarios = betaScenarios(sheet);
  // Billions as on his sheets, millions for smaller companies; fixed per company so typing doesn't switch it.
  const scale: Scale = (defaults.marketCap ?? 0) >= 1e10 || Math.abs(defaults.base.fcf ?? 0) >= 1e9 ? 1e9 : 1e6;
  const firstCountedYear = base.year + timing.firstCounted;
  const lastYear = base.year + PARKEV_YEARS;
  const typedYears = estimates.filter((value) => value !== null).length;

  function update(next: Partial<Omit<Working, "base">>) {
    if (openState) setOpenState({ ...openState, ...next });
    else writeSaved(key, JSON.stringify({ assumptions, estimates, timing, start: edits, ...next } satisfies SavedParkev));
  }

  function setAssumption(field: keyof ParkevAssumptions, value: number | null) {
    // An emptied box keeps the last value until a number is typed.
    if (value === null) return;
    update({ assumptions: { ...assumptions, [field]: value } });
  }

  function setTiming(field: keyof ParkevTiming, value: number | null) {
    if (value === null) return;
    update({ timing: { ...timing, [field]: value } });
  }

  function setEstimate(index: number, value: number | null) {
    update({ estimates: estimates.map((item, position) => (position === index ? value : item)) });
  }

  function setStart(field: StartField, value: number | null) {
    if (openState) {
      // Clearing a box goes back to the report's figure when the save starts from the same year.
      const sameYear = openState.base.year === defaults.base.year;
      const fallback = field === "fcf" ? (sameYear ? defaults.base.fcf : null) : sameYear ? defaults[field] : 0;
      setOpenState({ ...openState, base: { ...openState.base, [field]: value ?? fallback } });
    } else {
      writeSaved(key, JSON.stringify({ assumptions, estimates, timing, start: { ...edits, [field]: value } } satisfies SavedParkev));
    }
  }

  function reset() {
    if (openState) setOpenState(starting);
    else writeSaved(key, null);
    setMarketEdits({ marketCap: null, price: null });
    setVersion((current) => current + 1);
  }

  // What Save keeps: every input, the fiscal year it starts from with its figures, and a typed price or market cap.
  function snapshot(): ProjectionSnapshot {
    const inputs: ParkevInputs = { ...working, market: marketEdits };
    return {
      inputs,
      baseYear: base.year,
      priceAtSave: price,
      currency,
      valueAtSave: [{ id: "value", label: "Intrinsic value", value: valuation?.valuePerShare ?? null }],
    };
  }

  const betaRows: BetaRow[] = [
    { id: "inputs", label: "Your inputs", beta: assumptions.beta, wacc: valuation?.wacc ?? null, value: valuation?.valuePerShare ?? null, upside: valuation?.upside ?? null },
    ...scenarios.map(({ id, label, beta, result: scenario }) => ({
      id,
      label,
      beta,
      wacc: scenario.ok ? scenario.valuation.wacc : null,
      value: scenario.ok ? scenario.valuation.valuePerShare : null,
      upside: scenario.ok ? scenario.valuation.upside : null,
    })),
  ];
  const isDefaultTiming = timing.firstCounted === DEFAULT_TIMING.firstCounted && timing.firstYears === DEFAULT_TIMING.firstYears
    && timing.terminalYears === DEFAULT_TIMING.terminalYears;

  return (
    <div className="parkev-dcf">
      {opened && (
        <OpenedBanner
          name={opened.name}
          updatedAt={opened.updatedAt}
          draftHref={`${valuationTool("parkev-dcf").path}?symbol=${encodeURIComponent(symbol)}`}
          baseYear={base.year}
          latestYear={defaults.base.year}
          dropped={[...opened.dropped, ...(restored?.dropped ?? [])]}
        />
      )}
      <section className="projection-toolbar" aria-label="Market">
        <dl className="projection-stats">
          <div>
            <dt><label htmlFor="parkev-price">Current market price</label></dt>
            <dd>
              <NumberInput
                key={`price-${version}`}
                id="parkev-price"
                label="Current market price"
                value={price}
                unit="currency"
                currency={currency}
                onChange={(value) => setMarketEdits({ ...marketEdits, price: value })}
              />
            </dd>
          </div>
          <div>
            <dt><label htmlFor="parkev-market-cap" title={notes.shares}>Market cap</label></dt>
            <dd>
              <NumberInput
                key={`market-cap-${version}`}
                id="parkev-market-cap"
                label="Market cap, in millions"
                value={marketCap}
                unit="millions"
                currency={currency}
                onChange={(value) => setMarketEdits({ ...marketEdits, marketCap: value })}
              />
            </dd>
          </div>
          <div>
            <dt title={notes.shares}>Shares</dt>
            <dd>{valuation?.shares ? Math.round(valuation.shares).toLocaleString("en-US") : "—"}</dd>
          </div>
          <div>
            <dt>Today&apos;s change</dt>
            <dd className={toneOf(market.changePercent)}>{market.changePercent === null ? "—" : signedPercent(market.changePercent)}</dd>
          </div>
          <div>
            <dt>52-week range</dt>
            <dd>
              {market.yearLow === null || market.yearHigh === null
                ? "—"
                : `${formatCell(market.yearLow, "perShare", currency)}–${formatCell(market.yearHigh, "perShare", currency)}`}
            </dd>
          </div>
        </dl>
        <div className="projection-controls">
          <button className="assumptions-reset" type="button" onClick={reset}>Reset</button>
          <SaveProjection tool="parkev-dcf" symbol={symbol} status={saving.status} opened={opened} snapshot={snapshot} />
        </div>
        <p className="projection-status" role="status">
          Shares are market cap ÷ price, as on his sheets.
          {openState
            ? " Editing a saved valuation: Save updates it or saves a copy; Reset goes back to the starting values."
            : draft
              ? " Your inputs are saved in this browser; Reset goes back to the starting values. A typed price or market cap lasts for this visit."
              : " Boxed cells are inputs, and everything updates as you type."}
        </p>
      </section>

      <section className="projection-summary" aria-labelledby="parkev-summary-heading">
        <div className="projection-summary-figures">
          <div className="projection-summary-main">
            <p className="section-label" id="parkev-summary-heading">INTRINSIC VALUE PER SHARE</p>
            <strong>{formatCell(valuation?.valuePerShare ?? null, "perShare", currency)}</strong>
            <small>
              {valuation
                ? `Free cash flow from fiscal ${firstCountedYear} to ${lastYear} and a terminal value, discounted at a ${percent(valuation.wacc)} WACC, plus non-operating assets, less debt, over ${valuation.shares ? Math.round(valuation.shares).toLocaleString("en-US") : "the"} shares.`
                : reason}
            </small>
          </div>
          <dl className="projection-summary-stats">
            <div>
              <dt>Current market price</dt>
              <dd>{formatCell(price, "perShare", currency)}</dd>
            </div>
            <div>
              <dt>Upside / downside</dt>
              <dd className={toneOf(upside)}>{upside === null ? "—" : signedPercent(upside)}</dd>
            </div>
            <div>
              <dt>WACC</dt>
              <dd>{valuation ? percent(valuation.wacc) : "—"}</dd>
            </div>
          </dl>
        </div>
        {valuation && valuation.terminalShare !== null && valuation.terminalShare > 0.85 && (
          <p className="projection-notice">
            The terminal value is {percent(valuation.terminalShare)} of the value of operations: the estimate leans on the
            years after {lastYear}, so check the long-term growth and the WACC.
          </p>
        )}
      </section>

      <section className="projection-section" aria-labelledby="parkev-fcf-heading">
        <div className="content-section-heading">
          <div>
            <p className="section-label">FREE CASH FLOW</p>
            <h2 id="parkev-fcf-heading">Ten years, in {scaleWord(scale)} of {currency}</h2>
          </div>
          {typedYears > 0 && (
            <button className="assumptions-reset" type="button" onClick={() => update({ estimates: Array(PARKEV_YEARS).fill(null) })}>
              Grow every year
            </button>
          )}
        </div>
        <p className="projection-section-intro">
          Years 1–{SHORT_TERM_YEARS} grow at the short-term rate and {SHORT_TERM_YEARS + 1}–{PARKEV_YEARS} at the
          transition rate. Type a year&apos;s figure over its growth, such as analysts&apos; estimate, as he does; the
          years after grow from it. Emptying a box grows that year again.
        </p>
        <FcfTable
          key={`fcf-${version}`}
          baseYear={base.year}
          baseFcf={base.fcf}
          baseTyped={baseTyped}
          projected={projected}
          valued={valuation?.years ?? null}
          scale={scale}
          currency={currency}
          onBase={(value) => setStart("fcf", value)}
          onEstimate={setEstimate}
        />
        <p className="table-footnote">
          {notes.fcf} Fiscal {firstCountedYear} to {lastYear} are counted
          {timing.firstCounted > 1 ? `; ${base.year + 1}${timing.firstCounted > 2 ? `–${firstCountedYear - 1}` : ""} only grows the years after it` : ""}.
        </p>
      </section>

      <div className="parkev-layout">
        <section className="projection-section" aria-labelledby="parkev-inputs-heading">
          <p className="section-label">ASSUMPTIONS</p>
          <h2 id="parkev-inputs-heading">Your inputs</h2>
          <div className="parkev-inputs">
            <fieldset className="dcf-panel-choice">
              <legend>Growth</legend>
              <Field id="parkev-short" label={`Short-term, years 1–${SHORT_TERM_YEARS}`}>
                <NumberInput key={`short-${version}`} id="parkev-short" label="Short-term growth" value={assumptions.shortTermGrowth} unit="percent" currency={currency} onChange={(value) => setAssumption("shortTermGrowth", value)} />
              </Field>
              <Field id="parkev-transition" label={`Transition, years ${SHORT_TERM_YEARS + 1}–${PARKEV_YEARS}`}>
                <NumberInput key={`transition-${version}`} id="parkev-transition" label="Transition growth" value={assumptions.transitionGrowth} unit="percent" currency={currency} onChange={(value) => setAssumption("transitionGrowth", value)} />
              </Field>
              <Field id="parkev-long" label={`Long-term, after ${lastYear}`}>
                <NumberInput key={`long-${version}`} id="parkev-long" label="Long-term growth" value={assumptions.longTermGrowth} unit="percent" currency={currency} onChange={(value) => setAssumption("longTermGrowth", value)} />
              </Field>
              <p className="assumption-short">{notes.growth}</p>
            </fieldset>

            <fieldset className="dcf-panel-choice">
              <legend>Discount rate</legend>
              <Field id="parkev-beta" label="Beta" note={notes.beta}>
                <NumberInput key={`beta-${version}`} id="parkev-beta" label="Beta" value={assumptions.beta} unit="number" currency={currency} onChange={(value) => setAssumption("beta", value)} />
              </Field>
              <Field id="parkev-rf" label="Risk-free rate" note={notes.riskFreeRate}>
                <NumberInput key={`rf-${version}`} id="parkev-rf" label="Risk-free rate" value={assumptions.riskFreeRate} unit="percent" currency={currency} onChange={(value) => setAssumption("riskFreeRate", value)} />
              </Field>
              <Field id="parkev-mrp" label="Market risk premium">
                <NumberInput key={`mrp-${version}`} id="parkev-mrp" label="Market risk premium" value={assumptions.marketRiskPremium} unit="percent" currency={currency} onChange={(value) => setAssumption("marketRiskPremium", value)} />
              </Field>
              <Computed label="CAPM (cost of equity)" value={percent(assumptions.riskFreeRate + assumptions.beta * assumptions.marketRiskPremium)} />
              <Field id="parkev-cod" label="Cost of debt">
                <NumberInput key={`cod-${version}`} id="parkev-cod" label="Cost of debt" value={assumptions.costOfDebt} unit="percent" currency={currency} onChange={(value) => setAssumption("costOfDebt", value)} />
              </Field>
              <Field id="parkev-debt-weight" label="Debt weight">
                <NumberInput key={`debt-weight-${version}`} id="parkev-debt-weight" label="Debt weight" value={assumptions.debtWeight} unit="percent" currency={currency} onChange={(value) => setAssumption("debtWeight", value)} />
              </Field>
              <Computed label="Equity weight" value={percent(1 - assumptions.debtWeight)} />
              <Computed label="WACC" value={valuation ? percent(valuation.wacc) : "—"} strong />
              <p className="assumption-short">{notes.rates} WACC = equity weight × CAPM + debt weight × cost of debt, with no tax shield, as on his sheets.</p>
            </fieldset>

            <fieldset className="dcf-panel-choice">
              <legend>Balance sheet</legend>
              <Field id="parkev-cash" label="Non-operating assets" note={notes.nonOperatingAssets}>
                <NumberInput key={`cash-${version}`} id="parkev-cash" label="Non-operating assets, in millions" value={base.nonOperatingAssets} unit="millions" currency={currency} onChange={(value) => setStart("nonOperatingAssets", value)} />
              </Field>
              <Field id="parkev-debt" label="Debt" note={notes.debt}>
                <NumberInput key={`debt-${version}`} id="parkev-debt" label="Debt, in millions" value={base.debt} unit="millions" currency={currency} onChange={(value) => setStart("debt", value)} />
              </Field>
            </fieldset>

            <fieldset className="dcf-panel-choice">
              <legend>Discounting</legend>
              <Field id="parkev-first-counted" label="First year counted">
                <select
                  id="parkev-first-counted"
                  className="parkev-select"
                  value={timing.firstCounted}
                  onChange={(event) => setTiming("firstCounted", Number(event.target.value))}
                >
                  {Array.from({ length: PARKEV_YEARS }, (_, index) => (
                    <option key={index} value={index + 1}>
                      {base.year + index + 1}{index === 0 ? " (the year after the last report)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="parkev-first-years" label={`Years until ${firstCountedYear}'s cash flow`}>
                <NumberInput key={`first-years-${version}`} id="parkev-first-years" label={`Years until ${firstCountedYear}'s cash flow`} value={timing.firstYears} unit="period" currency={currency} onChange={(value) => setTiming("firstYears", value)} />
              </Field>
              <Field id="parkev-terminal-years" label="Years until the terminal value">
                <NumberInput key={`terminal-years-${version}`} id="parkev-terminal-years" label="Years until the terminal value" value={timing.terminalYears} unit="period" currency={currency} onChange={(value) => setTiming("terminalYears", value)} />
              </Field>
              <p className="assumption-short">
                Each year after {firstCountedYear} is a year further away. These follow his Netflix sheet
                {isDefaultTiming ? "" : " by default"}: the year after the one in progress at 1 year, the terminal value
                at 8.5. His Nvidia sheet counts from the year after that at 1.5 years with the terminal value at 7.5,
                and another of his sheets has the terminal value at 8.25.
              </p>
              {!isDefaultTiming && (
                <button
                  className="assumptions-reset"
                  type="button"
                  onClick={() => {
                    update({ timing: DEFAULT_TIMING });
                    setVersion((current) => current + 1);
                  }}
                >
                  Use his usual timing
                </button>
              )}
            </fieldset>
          </div>
        </section>

        <div className="parkev-results">
          <section className="projection-section" aria-labelledby="parkev-bridge-heading">
            <p className="section-label">VALUE</p>
            <h2 id="parkev-bridge-heading">From cash flows to a value per share</h2>
            {valuation ? (
              <>
                <dl className="dcf-bridge parkev-bridge">
                  <div>
                    <dt>Present value of fiscal {firstCountedYear}–{lastYear}</dt>
                    <dd>{wholeMoney(valuation.presentValueOfYears, currency)}</dd>
                  </div>
                  <div>
                    <dt>+ Present value of the terminal value</dt>
                    <dd>{wholeMoney(valuation.presentValueOfTerminal, currency)}</dd>
                  </div>
                  <div className="dcf-bridge-total">
                    <dt>= Value of operations</dt>
                    <dd>{wholeMoney(valuation.valueOfOperations, currency)}</dd>
                  </div>
                  <div>
                    <dt>+ Non-operating assets</dt>
                    <dd>{wholeMoney(base.nonOperatingAssets, currency)}</dd>
                  </div>
                  <div>
                    <dt>− Debt</dt>
                    <dd>{wholeMoney(base.debt, currency)}</dd>
                  </div>
                  <div className="dcf-bridge-total">
                    <dt>= Value of equity</dt>
                    <dd>{wholeMoney(valuation.valueOfEquity, currency)}</dd>
                  </div>
                  <div>
                    <dt>÷ Shares (market cap ÷ price)</dt>
                    <dd>{valuation.shares ? Math.round(valuation.shares).toLocaleString("en-US") : "—"}</dd>
                  </div>
                  <div className="dcf-bridge-total">
                    <dt>= Intrinsic value per share</dt>
                    <dd>{formatCell(valuation.valuePerShare, "perShare", currency)}</dd>
                  </div>
                  <div>
                    <dt>Against the {formatCell(price, "perShare", currency)} price</dt>
                    <dd className={toneOf(valuation.upside)}>{valuation.upside === null ? "—" : signedPercent(valuation.upside)}</dd>
                  </div>
                </dl>
                <p className="table-footnote">
                  The terminal value is fiscal {lastYear}&apos;s free cash flow × (1 + {percent(assumptions.longTermGrowth)}) ÷
                  (WACC − {percent(assumptions.longTermGrowth)}) = {wholeMoney(valuation.terminalValue, currency)},
                  discounted {Number(timing.terminalYears.toFixed(2))} years.
                </p>
              </>
            ) : (
              <p className="projection-notice">{reason}</p>
            )}
          </section>

          <section className="projection-section" aria-labelledby="parkev-beta-heading">
            <p className="section-label">SCENARIO ANALYSIS</p>
            <h2 id="parkev-beta-heading">With a higher or lower beta</h2>
            <BetaTable rows={betaRows} currency={currency} />
            <p className="table-footnote">As on his sheet: everything else stays as above, so only the CAPM and the WACC move.</p>
          </section>
        </div>
      </div>

      <section className="projection-section" aria-labelledby="parkev-how-heading">
        <div className="content-section-heading">
          <div>
            <p className="section-label">HOW IT WORKS</p>
            <h2 id="parkev-how-heading">From free cash flow to the value per share</h2>
          </div>
        </div>
        <ol className="three-year-steps">
          <li><strong>Free cash flow</strong> starts from fiscal {base.year} and grows at the short-term rate for {SHORT_TERM_YEARS} years, then the transition rate; a typed year replaces its growth, and the years after grow from it.</li>
          <li><strong>CAPM</strong> = risk-free rate + beta × market risk premium, and <strong>WACC</strong> = equity weight × CAPM + debt weight × cost of debt.</li>
          <li>Each counted year&apos;s <strong>present value</strong> is its free cash flow ÷ (1 + WACC)<sup>years</sup>.</li>
          <li>The <strong>terminal value</strong> is the last year&apos;s free cash flow × (1 + long-term growth) ÷ (WACC − long-term growth), discounted the same way.</li>
          <li><strong>Value of operations</strong> = the present values + the terminal value&apos;s; + non-operating assets − debt = <strong>value of equity</strong>; ÷ shares = <strong>intrinsic value per share</strong>.</li>
        </ol>
        <h3 className="projection-subheading">Where the starting values come from</h3>
        <ul className="projection-notes">
          <li><strong>Free cash flow: </strong>{notes.fcf}</li>
          <li><strong>Growth: </strong>{notes.growth}</li>
          <li><strong>Beta: </strong>{notes.beta}</li>
          <li><strong>Risk-free rate: </strong>{notes.riskFreeRate}</li>
          <li><strong>Rates: </strong>{notes.rates}</li>
          <li><strong>Non-operating assets and debt: </strong>{notes.nonOperatingAssets} {notes.debt}</li>
          <li><strong>Shares: </strong>{notes.shares}</li>
        </ul>
        <p className="projection-section-intro">
          This follows Parkev Tatevosian&apos;s discounted cash flow sheet: from the same inputs it gives the same present
          values, value of operations, value of equity and value per share as his sheets, to the dollar.
        </p>
      </section>

      <p className="projection-disclaimer">
        Valuations depend entirely on the inputs above. They are an educational tool, not investment advice.
      </p>
    </div>
  );
}
