import { redirect } from "next/navigation";
import { readSymbol, type ValuationSearchParams } from "../valuation-parts";

// This page's server actions wait for Gemini; on Vercel they get the Hobby plan's 300 seconds.
export const maxDuration = 300;

// Financial Projections became the Plumas Projection; keeps earlier links working.
export default async function FinancialProjectionsPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  redirect(symbol ? `/valuation/plumas-projection?symbol=${encodeURIComponent(symbol)}` : "/valuation/plumas-projection");
}
