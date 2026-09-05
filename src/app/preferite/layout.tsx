import type { Metadata } from "next";

/* La pagina è un client component (legge dal localStorage del browser),
 * quindi non può esportare metadata: il canonical vive qui, nel layout
 * della rotta, come per le altre pagine. */
export const metadata: Metadata = {
  title: "Preferite — DropAlert",
  description:
    "Le partite che segui con la tua soglia personale. La lista vive solo in questo browser.",
  alternates: { canonical: "/preferite" },
  /* la lista vive nel localStorage del visitatore: per un crawler la pagina
     è sempre lo stesso guscio vuoto. Contenuto sottile per definizione,
     quindi non si indicizza (ma si seguono i link). */
  robots: { index: false, follow: true },
};

export default function PreferiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
