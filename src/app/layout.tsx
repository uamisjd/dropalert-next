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
  alternates: { canonical: "/" },
  /* le anteprime social dicono le stesse cose della pagina, compreso il
     limite: nessun pronostico. Il disclaimer non si perde nella condivisione */
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
        alt: "DropAlert — osservatorio sui movimenti delle quote",
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50">
        {/* navigazione persistente: stesse voci su ogni pagina */}
        <SiteNav />
        {children}
        {/* footer legale: persistente su ogni pagina, non opzionale */}
        <SiteFooter />
      </body>
    </html>
  );
}
