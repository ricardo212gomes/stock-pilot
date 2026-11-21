import { AppShell } from "../../components/app-shell";
import { companyMetadata } from "../../components/company-metadata";
import { loadParkevData } from "../data";
import { ParkevDcf } from "../parkev-dcf";
import { loadSaving } from "../saved-data";
import { SavedSection } from "../saved-section";
import { LoadError, SecSourceNote, ToolStart, ValuationHeader, readSymbol, type ValuationSearchParams } from "../valuation-parts";

export const generateMetadata = companyMetadata("Parkev DCF", "A discounted cash flow valuation following Parkev Tatevosian's sheet: ten years of free cash flow, a terminal value and the WACC, to a value per share.");

export default async function ParkevDcfPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  const [loaded, saving] = symbol
    ? await Promise.all([loadParkevData(symbol), loadSaving(symbol, "parkev-dcf", (await searchParams).saved)])
    : [null, null];

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="parkev-dcf">
      {!symbol || !loaded ? (
        <ToolStart tool="parkev-dcf" title="What are a company's future cash flows worth today?">
          Search for a ticker above to value it the way Parkev Tatevosian does on his sheets: ten years of free cash
          flow from the last report, with a short-term and a transition growth rate or your own estimates, a terminal
          value, and the WACC from beta, the risk-free rate and the market risk premium, down to an intrinsic value per
          share against today&apos;s price.
        </ToolStart>
      ) : (
        <>
          <ValuationHeader symbol={symbol} tool="parkev-dcf">
            A discounted cash flow valuation following Parkev Tatevosian&apos;s sheet, from the last annual report.
          </ValuationHeader>
          {!loaded.ok ? (
            <LoadError symbol={symbol} reason={loaded.reason} />
          ) : (
            <>
              {saving && <SavedSection symbol={symbol} tool="parkev-dcf" saving={saving} />}
              <ParkevDcf
                key={saving?.opened?.id ?? "draft"}
                symbol={symbol}
                defaults={loaded.data.defaults}
                market={loaded.data.market}
                saving={{ status: saving?.status ?? "unavailable", opened: saving?.opened ?? null }}
              />
              <SecSourceNote source={loaded.data.source} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
