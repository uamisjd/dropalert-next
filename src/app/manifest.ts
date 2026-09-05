import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/* Manifesto PWA minimo: nome, icona e colore del brand. Niente scorciatoie
   né modalità standalone spinte: il sito resta un sito, installabile come
   collegamento con l'icona giusta invece di quella generica. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DropAlert — segnali quantitativi per scommesse sul calcio",
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    lang: "it-IT",
    icons: [
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
