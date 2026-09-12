/** Pagina Performance: una sola lettura per grafico, conteggi e fasce. */
import type { Metadata } from "next";
import { getPerformanceView } from "@/lib/repo/performance";
import { PerformanceContent } from "@/components/PerformanceContent";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Performance — DropAlert",
  description:
    "Evoluzione nel tempo del CLV, l'unica metrica di qualità pubblicata da DropAlert, con il campione dichiarato. Non è un rendimento né un consiglio.",
  alternates: { canonical: "/performance" },
};

export default async function PerformancePage() {
  const view = await getPerformanceView(new Date()).catch(() => null);
  return <PerformanceContent view={view} />;
}
