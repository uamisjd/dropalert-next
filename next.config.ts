import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Origini ammesse in sviluppo.
   *
   * Il server di sviluppo blocca le richieste cross-origin verso i propri
   * asset: senza questa voce, chi apre il sito da un host di preview
   * (sottodominio `e2b.app`) si vede rifiutare gli asset di sviluppo e la
   * pagina resta bianca. Non tocca la produzione, dove il blocco non esiste.
   */
  allowedDevOrigins: ["*.e2b.app"],

  /**
   * Gli URL pubblici della copertura restano `/coverage` e
   * `/api/coverage`, ma i file vivono in cartelle `cov/`.
   *
   * Motivo: l'ambiente di lavoro esclude dagli snapshot ogni directory
   * chiamata `coverage` (nome riservato ai report di copertura dei test),
   * e i file di questo progetto ci finivano dentro andando persi. Il nome
   * della cartella è cambiato; l'indirizzo visibile no.
   */
  /**
   * Cache di bordo per le pagine di contenuto.
   *
   * La home legge i filtri dalla query string, quindi resta renderizzata a
   * richiesta: senza un'intestazione esplicita finirebbe con `no-store` e
   * ogni visita ripagherebbe l'interrogazione al database. Con `s-maxage`
   * la CDN serve la stessa risposta per cinque minuti e nel frattempo la
   * rinfresca in background (`stale-while-revalidate`), mentre il browser
   * non conserva nulla (`max-age=0`): la freschezza resta quella dichiarata
   * dal pannello «Stato dati», non quella di una copia locale invisibile.
   *
   * Le scritture non passano di qui: il collector gira su GitHub Actions.
   */
  async headers() {
    const edgeCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      },
    ];
    return [
      { source: "/", headers: edgeCache },
      { source: "/matches/:id", headers: edgeCache },
    ];
  },

  /**
   * La pagina delle preferite è nata come `/watchlist` e la navigazione la
   * chiamava «Preferite»: chi provava `/preferite` trovava un 404. L'URL
   * canonico è ora quello italiano, e il vecchio indirizzo reindirizza in
   * permanenza invece di sparire.
   */
  async redirects() {
    return [{ source: "/watchlist", destination: "/preferite", permanent: true }];
  },

  async rewrites() {
    return [
      { source: "/api/coverage", destination: "/api/cov" },
      { source: "/coverage", destination: "/cov" },
    ];
  },
};

export default nextConfig;
