import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  /* nessun canonical globale: ogni pagina dichiara il proprio. Un canonical
     "/" ereditato direbbe ai motori che tutte le pagine sono la home. */
  /* le anteprime social dicono le stesse cose della pagina, compreso il
     limite: nessuna vincita garantita. Il disclaimer non si perde nella
     condivisione */
  openGraph: {
    type: "website",
    locale: "it_IT",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: `${SITE_URL}/og-cover.png`,
        width: 1200,
        height: 630,
        alt: "DropAlert — terminale quantitativo per scommesse sul calcio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/og-cover.png`],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
};

/* Dati strutturati del sito (YMYL: chi pubblica cosa va dichiarato anche
   alle macchine, non solo nelle pagine). */
const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "it-IT",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
        />
        {/* navigazione persistente: stesse voci su ogni pagina */}
        <SiteNav />
        {children}
        {/* footer legale: persistente su ogni pagina, non opzionale */}
        <SiteFooter />
      </body>
    </html>
  );
}
