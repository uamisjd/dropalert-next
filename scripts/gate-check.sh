#!/usr/bin/env bash
#
# Gate PRE-INSTALL del giro schedulato (Sprint OPS-2).
#
# PERCHÉ ESISTE: il workflow installava le dipendenze (npm ci, ~40-60 s di
# runner) prima ancora di sapere se c'era qualcosa da raccogliere. Con
# quattro occasioni orarie la maggioranza dei trigger viene poi scartata dal
# gate interno: pagavamo minuti per scoprire di non dover fare nulla.
#
# Questo script risponde alla sola domanda «serve raccogliere?» leggendo
# l'ultima raccolta da Neon con `psql` (preinstallato sui runner GitHub),
# SENZA installare nulla e SENZA toccare la fonte delle quote.
#
# Contratto: scrive `run=true|false` su $GITHUB_OUTPUT ed esce sempre 0.
# In caso di dubbio (database non leggibile, psql assente) risponde `true`:
# meglio un giro in più, che il gate interno può ancora fermare, che una
# raccolta persa per un errore di lettura.
set -uo pipefail

# Soglia dello skip anticipato, volutamente PIÙ BASSA dell'intervallo reale
# del codice (COLLECT_INTERVAL_MINUTES, 45): così questo script non può mai
# scartare un giro che il gate interno avrebbe invece eseguito.
SKIP_IF_YOUNGER_THAN_MIN="${GATE_SKIP_MINUTES:-40}"

emit() {
  echo "run=$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "gate: run=$1 — $2"
}

if [ -z "${DATABASE_URL:-}" ]; then
  emit true "DATABASE_URL assente: la decisione spetta al job, non a questo controllo."
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  emit true "psql non disponibile sul runner: nessuna lettura possibile qui."
  exit 0
fi

# Questo è il gate del ciclo COMPLETO, non il gate della fonte. Legge soltanto
# `scheduler:last_cycle`: il collect-only aggiorna invece last_collection +
# claim. Se qui si rispettasse il claim del fallback, uno scheduler esterno
# puntuale potrebbe impedire per sempre ad Actions di eseguire analisi,
# chiusure e notifiche. Una volta avviato, `runCycle` applica autonomamente il
# gate della fonte e può saltare la rete pur completando le fasi locali.
LAST_AT="$(psql "$DATABASE_URL" -At -c \
  "select value->>'at' from system_state \
     where key = 'scheduler:last_cycle' limit 1" \
  2>/dev/null || true)"

if [ -z "$LAST_AT" ]; then
  emit true "nessun giro precedente a registro: si esegue."
  exit 0
fi

LAST_EPOCH="$(date -u -d "$LAST_AT" +%s 2>/dev/null || echo "")"
if [ -z "$LAST_EPOCH" ]; then
  emit true "istante dell'ultimo giro non interpretabile: si esegue."
  exit 0
fi

NOW_EPOCH="$(date -u +%s)"
AGE_MIN=$(( (NOW_EPOCH - LAST_EPOCH) / 60 ))

if [ "$AGE_MIN" -lt "$SKIP_IF_YOUNGER_THAN_MIN" ]; then
  emit false "ultimo giro ${AGE_MIN} min fa (< ${SKIP_IF_YOUNGER_THAN_MIN}): nessuna installazione, nessuna richiesta alla fonte."
  exit 0
fi

emit true "ultimo giro ${AGE_MIN} min fa (>= ${SKIP_IF_YOUNGER_THAN_MIN}): si procede."
exit 0
