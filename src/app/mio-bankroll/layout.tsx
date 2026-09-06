import type { Metadata } from "next";

/* La pagina è un client component (legge dal localStorage del browser),
 * quindi non può esportare metadata: il canonical vive qui, nel layout
 * della rotta, come per /preferite. */
export const metadata: Metadata = {
  title: "Il mio bankroll — DropAlert",
  description:
    "Tracking personale delle scommesse: ROI, CLV e drawdown. I dati vivono solo in questo browser.",
  alternates: { canonical: "/mio-bankroll" },
  /* il tracking vive nel localStorage del visitatore: per un crawler la
     pagina è sempre lo stesso guscio vuoto. Contenuto sottile per
     definizione, quindi non si indicizza (ma si seguono i link), come
     /preferite. */
  robots: { index: false, follow: true },
};

export default function MioBankrollLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
