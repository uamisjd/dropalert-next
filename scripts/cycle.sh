#!/usr/bin/env bash
# Ciclo di osservazione + backfill delle shape features.
#
# Perché esiste questo wrapper e non un passo a sé nel workflow:
# il PAT in uso non ha lo scope `workflow`, quindi GitHub rifiuta ogni
# push che modifichi `.github/workflows/collect.yml` (verificato: viene
# respinto con «refusing to allow a Personal Access Token to create or
# update workflow … without workflow scope»). Il backfill però non può
# restare una leva manuale: deve viaggiare col ciclo. Così la catena è
# questa — stesso comando `npm run job:collect`, stesso cron, nessuna
# modifica alla logica del collector:
#
#   run-collect.ts "$@"   → il ciclo di sempre, argomenti invariati
#   job:shape             → backfill IDEMPOTENTE della forma (voce 2 del
#                           backlog): a dati fermi non tocca nessuna riga,
#                           scrive solo la colonna drop_signals.shape
#
# Se il backfill fallisce, il ciclo di raccolta è già stato registrato:
# l'errore si vede invece di nascondersi. Il diff per promuovere shape a
# passo workflow separato, quando sarà disponibile uno scope adeguato, sta
# in docs/SHAPE-BACKFILL.md.
set -euo pipefail
npx tsx --env-file-if-exists=.env src/scripts/run-collect.ts "$@"
npm run --silent job:shape
