"use client";

/**
 * Comandi delle notifiche push nella pagina Preferite (Fase B).
 *
 * Tre stati possibili, tutti dichiarati a schermo invece che lasciati
 * indovinare: notifiche non supportate dal browser, non configurate sul
 * server, oppure attive. Il pulsante non finge mai di funzionare: se manca
 * qualcosa resta disabilitato e la pagina spiega perché.
 *
 * La watchlist viaggia insieme all'iscrizione: il server non sa chi sei, sa
 * solo quali partite hai chiesto di seguire e con quale soglia.
 */
import { useCallback, useEffect, useState } from "react";
import { readPushToken, savePushToken, clearPushToken, pushHeaders, verificationFromHash } from "@/lib/push/client";
import {
  DEDUPE_NOTE,
  PLATFORM_NOTE,
} from "@/lib/push/pure";
import {
  WATCHLIST_KEY,
  parseWatchlist,
  type WatchEntry,
} from "@/lib/view/watchlist";

type Stato =
  | "verifica"
  | "non-supportato"
  | "non-configurato"
  | "spento"
  | "attesa"
  | "attivo"
  | "negato";

/* la chiave VAPID arriva in base64url e il browser la vuole in byte;
   il buffer è dichiarato ArrayBuffer perché è ciò che `subscribe` accetta */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readWatchlist(): WatchEntry[] {
  try {
    return parseWatchlist(window.localStorage.getItem(WATCHLIST_KEY));
  } catch {
    return [];
  }
}

/** Corpo inviato al server: iscrizione + watchlist, niente altro. */
function payloadFor(sub: PushSubscription): unknown {
  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  return {
    subscription: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    },
    watchlist: readWatchlist().map((w) => ({
      matchKey: w.key,
      matchId: w.matchId,
      homeTeam: w.homeTeam,
      awayTeam: w.awayTeam,
      thresholdKind: w.thresholdKind,
      thresholdValue: w.thresholdValue,
    })),
  };
}

export function PushControls() {
  const [stato, setStato] = useState<Stato>("verifica");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [listaModificata, setListaModificata] = useState(false);

  const supportato = useCallback(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    [],
  );

  useEffect(() => {
    let annullato = false;
    (async () => {
      if (!supportato()) {
        if (!annullato) setStato("non-supportato");
        return;
      }
      try {
        const res = await fetch("/api/push/subscribe", { cache: "no-store" });
        const body = (await res.json()) as {
          configured?: boolean;
          publicKey?: string | null;
        };
        if (annullato) return;
        if (body.configured !== true || !body.publicKey) {
          setStato("non-configurato");
          return;
        }
        setPublicKey(body.publicKey);
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setStato(
          Notification.permission === "denied"
            ? "negato"
            : sub && readPushToken(sub.endpoint)
              ? "attivo"
              : "spento",
        );
      } catch {
        if (!annullato) setStato("non-configurato");
      }
    })();
    return () => {
      annullato = true;
    };
  }, [supportato]);

  useEffect(() => {
    const changed = () => setListaModificata(true);
    const confirm = async () => {
      const proof = verificationFromHash(window.location.hash);
      if (!proof) return;
      // Rimuovi subito il segreto dalla barra e dalla cronologia corrente.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setInCorso(true);
      try {
        const response = await fetch("/api/push/confirm", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proof),
        });
        const body = await response.json() as { ok?: boolean; endpoint?: string; token?: string; reason?: string };
        if (!response.ok || !body.ok || !body.endpoint || !body.token) throw new Error(body.reason ?? "conferma non riuscita");
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub?.endpoint !== body.endpoint) throw new Error("apri la conferma sul browser che ha richiesto le notifiche");
        savePushToken(body.endpoint, body.token);
        setStato("attivo");
        setMessaggio("Notifiche verificate e attive. Usa Aggiorna lista quando cambi partite o soglie.");
      } catch (error) {
        setStato("spento");
        setMessaggio(`Conferma non completata: ${error instanceof Error ? error.message : "riprovare"}.`);
      } finally { setInCorso(false); }
    };
    void confirm();
    window.addEventListener("hashchange", confirm);
    window.addEventListener("dropalert:watchlist", changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("hashchange", confirm);
      window.removeEventListener("dropalert:watchlist", changed);
      window.removeEventListener("storage", changed);
    };
  }, []);

  async function attiva(forceVerification = false) {
    if (publicKey === null) return;
    setInCorso(true);
    setMessaggio(null);
    try {
      const permesso = await Notification.requestPermission();
      if (permesso !== "granted") {
        setStato(permesso === "denied" ? "negato" : "spento");
        setMessaggio("Permesso non concesso: nessuna notifica verrà inviata.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: forceVerification ? { "content-type": "application/json" } : pushHeaders(sub.endpoint),
        body: JSON.stringify(payloadFor(sub)),
      });
      if (res.status === 202) {
        setStato("attesa");
        setMessaggio("Apri la notifica di conferma entro 5 minuti. L’iscrizione non è ancora attiva; se non arriva puoi richiedere una nuova verifica.");
        return;
      }
      if (!res.ok) {
        const error = await res.json().catch(() => null) as { reason?: unknown } | null;
        throw new Error(typeof error?.reason === "string" ? error.reason : "registrazione non riuscita");
      }
      setStato("attivo");
      setListaModificata(false);
      setMessaggio(
        "Notifiche attive su questo browser. La lista seguita è stata inviata insieme all'iscrizione.",
      );
    } catch (error) {
      setMessaggio(`Attivazione non completata: ${error instanceof Error ? error.message : "riprovare più tardi"}.`);
    } finally {
      setInCorso(false);
    }
  }

  async function disattiva() {
    setInCorso(true);
    setMessaggio(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const token = readPushToken(sub.endpoint);
        if (token) {
        const response = await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: pushHeaders(sub.endpoint),
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!response.ok) throw new Error("cancellazione sul server non riuscita");
        }
        await sub.unsubscribe();
      }
      clearPushToken();
      setStato("spento");
      setMessaggio("Notifiche disattivate su questo browser. Le iscrizioni verificate con autorizzazione disponibile sono state cancellate dal server; eventuali dati legacy scadranno secondo l’informativa.");
    } catch {
      setMessaggio("Disattivazione non completata. Riprova prima di cancellare i dati del browser.");
    } finally {
      setInCorso(false);
    }
  }

  async function prova() {
    setInCorso(true);
    setMessaggio(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) {
        setMessaggio("Nessuna iscrizione attiva su questo browser.");
        return;
      }
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: pushHeaders(sub.endpoint),
        body: JSON.stringify({ subscription: json }),
      });
      const body = (await res.json()) as { ok?: boolean; reason?: string };
      setMessaggio(
        body.ok === true
          ? "Notifica di prova inviata: dovrebbe comparire fra pochi secondi."
          : `Prova non riuscita: ${body.reason ?? "motivo non dichiarato"}.`,
      );
    } catch {
      setMessaggio("Prova non riuscita: il server non ha risposto.");
    } finally {
      setInCorso(false);
    }
  }

  const disabilitato =
    inCorso || stato === "verifica" || stato === "non-supportato" ||
    stato === "non-configurato" || stato === "negato";

  return (
    <section
      aria-labelledby="notifiche-push"
      className="mt-5 rounded-lg border border-slate-200 bg-white p-3"
    >
      <h2
        id="notifiche-push"
        className="mb-1 text-xs font-semibold tracking-wide text-slate-900 uppercase"
      >
        Notifiche
      </h2>

      <div className="flex flex-wrap gap-2">
        {stato === "attivo" || stato === "attesa" ? (
          <button
            type="button"
            onClick={disattiva}
            disabled={inCorso}
            className="rounded border border-slate-800 bg-slate-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Disattiva notifiche
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void attiva()}
            disabled={disabilitato}
            className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-800 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Attiva notifiche
          </button>
        )}
        {stato === "attivo" ? (
          <button type="button" onClick={() => void attiva()} disabled={inCorso}
            className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">
            Aggiorna lista{listaModificata ? " (modificata)" : ""}
          </button>
        ) : null}
        <button type="button" disabled={disabilitato}
          onClick={() => void attiva(true)}
          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">
          Verifica di nuovo
        </button>
        <button
          type="button"
          onClick={prova}
          disabled={stato !== "attivo" || inCorso}
          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Test notifica
        </button>
      </div>

      {messaggio !== null ? (
        <p role="status" aria-live="polite" className="mt-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
          {messaggio}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {stato === "non-supportato"
          ? "Questo browser non supporta le notifiche web: il pulsante resta disattivato e il resto del sito funziona normalmente. "
          : stato === "non-configurato"
            ? "Notifiche non configurate sul server: il pulsante resta disattivato invece di fallire in silenzio. "
            : stato === "negato"
              ? "Hai negato il permesso a questo sito: per riattivarlo devi consentirlo dalle impostazioni del browser. "
              : ""}
        Ricevi un avviso solo per le partite in questa lista che superano la
        soglia che hai impostato: mai per altre partite. {DEDUPE_NOTE}{" "}
        {PLATFORM_NOTE} L&apos;avviso descrive un movimento di mercato:
        nessuna vincita garantita. Si possono sincronizzare al massimo 100
        partite. Le prove sono limitate a 3 ogni 15 minuti per iscrizione;
        sono previsti anche limiti complessivi del servizio. Un limite temporaneo
        non impedisce di disattivare le notifiche. L’attivazione richiede
        l’apertura della notifica di conferma. Il browser conserva una chiave
        di gestione locale: se la perdi, usa «Verifica di nuovo». Dopo aver
        cambiato preferite o soglie, premi «Aggiorna lista». La sincronizzazione
        rinnova per 90 giorni l’iscrizione; senza rinnovo scade.
      </p>
    </section>
  );
}
