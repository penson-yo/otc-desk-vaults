import { Dashboard } from "@/components/dashboard";
import { DEFAULT_WATCH_WALLETS } from "@/lib/otc/constants";
import { loadPortfolio } from "@/lib/otc/portfolio";
import type { PortfolioResponse } from "@/lib/otc/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  let initialData: PortfolioResponse | null = null;
  let initialError: string | null = null;
  try {
    initialData = await Promise.race([
      loadPortfolio(DEFAULT_WATCH_WALLETS.map((w) => ({ ...w }))),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out reading the chain on first paint.")),
          28_000,
        ),
      ),
    ]);
  } catch (err) {
    initialError = err instanceof Error ? err.message : String(err);
  }
  return (
    <Dashboard initialData={initialData} initialError={initialError} />
  );
}
