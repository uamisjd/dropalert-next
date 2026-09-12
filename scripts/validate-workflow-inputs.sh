#!/usr/bin/env bash
# Valida solo input, senza DB/rete e senza stampare valori ricevuti.
# I workflow passano gli input tramite env, mai interpolandoli in shell.
set -euo pipefail
fail() { echo "::error::$1" >&2; exit 1; }

case "${1:-}" in
  audit)
    case "${INPUT_WHICH:-}" in
      value|finished|both|smoke-odds|smoke-wire|control|migration-rehearsal|migration-apply-production) ;;
      *) fail "Modalità audit non valida." ;;
    esac ;;
  smoke)
    case "${INPUT_MODE:-}" in
      trova-partita) ;;
      smoke-test) [[ -n "${INPUT_MATCH_ID:-}" ]] || fail "Per lo smoke-test serve match_id." ;;
      *) fail "Modalità smoke non valida." ;;
    esac ;;
  rebase)
    case "${INPUT_MODE:-}" in dry-run|apply) exit 0 ;; *) fail "Modalità ribasatura non valida." ;; esac ;;
  *) fail "Workflow non riconosciuto." ;;
esac

if [[ -n "${INPUT_MATCH_ID:-}" ]]; then
  [[ "$INPUT_MATCH_ID" =~ ^[1-9][0-9]{0,9}$ ]] || fail "match_id deve essere un intero positivo."
  (( INPUT_MATCH_ID <= 2147483647 )) || fail "match_id fuori intervallo."
fi
[[ "${INPUT_HOURS:-}" =~ ^[1-9][0-9]{0,2}$ ]] || fail "ore deve essere un intero fra 1 e 720."
(( INPUT_HOURS <= 720 )) || fail "ore deve essere un intero fra 1 e 720."
if [[ -n "${INPUT_SPORT_KEY:-}" ]]; then
  [[ "$INPUT_SPORT_KEY" =~ ^soccer_[a-z0-9_]{1,100}$ ]] || fail "sport_key deve essere una chiave calcio soccer_ valida."
fi
