import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DropAlert — Osservatorio sui movimenti delle quote",
  description:
    "Monitoraggio statistico dei movimenti di quota nel calcio: ampiezza, conferme, persistenza e qualità del dato. Non è un servizio di pronostici.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-50">
        {children}
        {/* footer legale: persistente su ogni pagina, non opzionale */}
        <SiteFooter />
      </body>
    </html>
  );
}
