import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Gli URL pubblici della copertura restano `/coverage` e
   * `/api/coverage`, ma i file vivono in cartelle `cov/`.
   *
   * Motivo: l'ambiente di lavoro esclude dagli snapshot ogni directory
   * chiamata `coverage` (nome riservato ai report di copertura dei test),
   * e i file di questo progetto ci finivano dentro andando persi. Il nome
   * della cartella è cambiato; l'indirizzo visibile no.
   */
  async rewrites() {
    return [
      { source: "/api/coverage", destination: "/api/cov" },
      { source: "/coverage", destination: "/cov" },
    ];
  },
};

export default nextConfig;
