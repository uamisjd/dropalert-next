/**
 * Suite di test per i motori quantitativi di DropAlert Pro:
 *  - Devigging Avanzato (Shin, Power, Proportional)
 *  - Expected Value (+EV) e Rilevamento Alpha
 *  - Staking di Kelly Frazionale
 *  - Dixon-Coles & Simulazione Poisson
 *  - Surebet & Dutching
 *  - Trading Exchange (Green-Up & Tick Ladder)
 *  - Quote Sintetiche
 */
import { devigShin, devigPower, devigProportional, getBestFairOdds } from "../devig-advanced";
import { calculateEV, findValueFromSharpPrices } from "../ev-engine";
import { computeValueGap } from "../value-gap";
import { calculateKellyStake } from "../kelly";
import { simulateDixonColes, estimateTeamExpectancy } from "../dixon-coles";
import { calculateArbitrage, calculateDutching } from "../arbitrage";
import { calculateGreenUp, calculateTickDistance } from "../exchange-trading";
import { buildSyntheticMarkets, detectMarketDiscrepancy } from "../synthetic-odds";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

console.log("\n[1] De-Vigging Avanzato (Shin, Power, Proportional)");
{
  // Test 1X2 classico con margine 105%
  const prices = [2.0, 3.4, 4.0];
  const shin = devigShin(prices);
  assert(shin !== null, "Shin devigging produce un risultato valido");
  assert(shin?.method === "shin", "Metodo Shin identificato");
  assert(shin !== null && shin.fairProbabilities.length === 3, "Tre probabilità generate");
  
  const sumP = shin ? shin.fairProbabilities.reduce((a, b) => a + b, 0) : 0;
  assert(Math.abs(sumP - 1.0) < 0.001, `Probabilità Shin sommano a 1.0 (${sumP})`);
  assert(shin !== null && shin.fairOdds[0] > 2.0, "La quota fair è superiore alla quota grezza con vig");

  const power = devigPower(prices);
  assert(power !== null, "Power devigging produce un risultato valido");
  const sumPower = power ? power.fairProbabilities.reduce((a, b) => a + b, 0) : 0;
  assert(Math.abs(sumPower - 1.0) < 0.001, "Probabilità Power sommano a 1.0");

  const best = getBestFairOdds(prices);
  assert(best !== null && best.method === "shin", "getBestFairOdds preferisce Shin per 1X2");
}

console.log("\n[2] Expected Value (+EV) ed Edge %");
{
  // Quota offerta 2.20 con probabilità reale 50% (fair odds 2.00)
  const ev1 = calculateEV(2.2, { fairOdds: 2.0 });
  assert(ev1 !== null && ev1.hasEdge === true, "Rilevato edge positivo su 2.20 vs fair 2.00");
  assert(ev1 !== null && Math.abs(ev1.edgePct - 10.0) < 0.05, `Edge corretto a +10.0% (calcolato: ${ev1?.edgePct}%)`);

  // Quota senza edge: 1.80 con fair 2.00
  const ev2 = calculateEV(1.8, { fairOdds: 2.0 });
  assert(ev2 !== null && ev2.hasEdge === false, "Nessun edge su quota sotto fair");
  assert(ev2 !== null && ev2.edgePct < 0, "Edge negativo");

  // Confronto Sharp vs Soft
  const sharpPrices = [1.95, 3.5, 4.2]; // Pinnacle
  const softPrices = [2.15, 3.4, 3.8]; // Soft bookmaker ritardatario
  const valueOutcomes = findValueFromSharpPrices(softPrices, sharpPrices);
  assert(valueOutcomes.length === 3, "Valutati 3 esiti");
  assert(valueOutcomes[0].hasValue === true, "Esito 1 identificato come +EV rispetto a Sharp");
  assert(valueOutcomes[0].edgePct > 5.0, "Edge superiore al 5%");
}

console.log("\n[2b] Divario vs linea no-vig (`computeValueGap`)");
{
  // Terna completa con margine: la fair è sopra la quota, il divario è negativo
  // per costruzione — ed è giusto che sia così: il margine c'è, il valore no.
  const gap = computeValueGap({
    market: "1x2",
    selection: "home",
    currentPrice: 2.0,
    line: { home: 2.0, draw: 3.4, away: 3.9 },
  });
  assert(gap.ok === true, "linea completa: divario calcolato");
  if (gap.ok) {
    assert(gap.marginPct > 4 && gap.marginPct < 10, `margine osservato sulla linea: ${gap.marginPct}%`);
    assert(gap.fairOdds > 2.0, `fair sopra la quota grezza (${gap.fairOdds})`);
    assert(gap.edgePct < 0, `divario negativo su quota = linea del book: ${gap.edgePct}%`);
    /* il divario dev'essere esattamente fairProb × prezzo − 1, né più né meno */
    assert(
      Math.abs(gap.edgePct - (100 * (2.0 / gap.fairOdds) - 100)) < 0.05,
      `divario = fairProb × prezzo − 1 (${gap.edgePct}% vs fair ${gap.fairOdds})`,
    );
    assert(gap.selectionsUsed === 3, "terna completa usata: 3 selezioni");
  }

  // Quota più generosa della media del mercato: divario positivo
  const good = computeValueGap({
    market: "1x2",
    selection: "home",
    currentPrice: 2.2,
    line: { home: 2.0, draw: 3.4, away: 3.9 },
  });
  assert(good.ok === true && good.edgePct > 0, "quota sopra fair: divario positivo");

  // Terna incompleta: nessun numero, e il motivo scritto
  const missing = computeValueGap({
    market: "1x2",
    selection: "home",
    currentPrice: 2.0,
    line: { home: 2.0, draw: 3.4 },
  });
  assert(missing.ok === false, "linea incompleta: nessun divario, nessuna stima");
  assert(
    missing.ok === false && missing.reason.includes("away"),
    "il motivo dice quale selezione manca",
  );

  // Il pavimento a +0,5% non c'è più: un divario lievemente negativo resta negativo
  const tiny = computeValueGap({
    market: "ou_2_5",
    selection: "over",
    currentPrice: 1.9,
    line: { over: 1.9, under: 1.95 },
  });
  assert(tiny.ok === true && tiny.edgePct < 0, `nessun pavimento: edge ${tiny.ok ? tiny.edgePct : "n/d"}% mostrato`);
}

console.log("\n[3] Money Management & Criterio di Kelly");
{
  // Quota 2.00 con probabilità 55% -> Full Kelly = (0.55 * 1 - 0.45) / 1 = 10%
  const k = calculateKellyStake({
    offeredOdds: 2.0,
    trueProbability: 0.55,
    bankroll: 1000,
    tier: "quarter",
  });
  assert(k.hasEdge === true, "Kelly rileva edge");
  assert(Math.abs(k.fullKellyPct - 10.0) < 0.1, `Full Kelly = 10% (calcolato: ${k.fullKellyPct}%)`);
  assert(Math.abs(k.quarterKellyPct - 2.5) < 0.1, `Quarter Kelly = 2.5% (calcolato: ${k.quarterKellyPct}%)`);
  assert(k.recommendedStakeAmount === 25.0, `Importo consigliato su 1000€ = 25€ (calcolato: ${k.recommendedStakeAmount}€)`);
  assert(k.growthRatePct > 0, "Tasso di crescita geometrico positivo");
}

console.log("\n[4] Dixon-Coles & Poisson Bivariato");
{
  const sim = simulateDixonColes({
    lambdaHome: 1.65,
    muAway: 1.05,
    rho: -0.12,
  });
  assert(sim.scoreMatrix.length === 7, "Matrice 7x7 generata");
  assert(sim.probabilities.homeWinPct > sim.probabilities.awayWinPct, "Squadra di casa favorita coerentemente con lambda > mu");
  assert(sim.probabilities.over25Pct + sim.probabilities.under25Pct === 100, "Over 2.5 + Under 2.5 somma al 100%");
  assert(sim.probabilities.bttsYesPct + sim.probabilities.bttsNoPct === 100, "BTTS Si + No somma al 100%");
  assert(sim.fairOdds.homeWin < sim.fairOdds.awayWin, "Quota fair Home inferiore a quota fair Away");
  assert(sim.mostLikelyScores.length > 0, "Generati i risultati esatti più probabili");

  const est = estimateTeamExpectancy({
    homeAttackRating: 1.2,
    homeDefenseRating: 0.9,
    awayAttackRating: 1.0,
    awayDefenseRating: 1.1,
  });
  assert(est.lambdaHome > est.muAway, "Expectancy home maggiore di away");
}

console.log("\n[5] Surebet (Arbitraggio) & Dutching");
{
  // Esempio surebet a 2 vie: Over 2.5 a 2.10 e Under 2.5 a 2.10
  const arb = calculateArbitrage([
    { label: "Over 2.5", bookmaker: "BookA", odds: 2.1 },
    { label: "Under 2.5", bookmaker: "BookB", odds: 2.1 },
  ], 1000);
  assert(arb.isArbitrage === true, "Surebet identificata correttamente");
  assert(arb.guaranteedProfit > 0, `Profitto garantito positivo: ${arb.guaranteedProfit}€`);
  assert(arb.profitPct > 4.5, `Rendimento surebet > 4.5% (calcolato: ${arb.profitPct}%)`);

  // Dutching su 2 risultati esatti (es. 1-0 quota 7.0 e 2-0 quota 8.0)
  const dutch = calculateDutching([
    { label: "1-0", odds: 7.0 },
    { label: "2-0", odds: 8.0 },
  ], 100);
  assert(dutch !== null, "Dutching calcolato");
  assert(dutch !== null && Math.abs(dutch.outcomes[0].profit - dutch.outcomes[1].profit) < 1.0, "Profitti equalizzati tra gli esiti");
}

console.log("\n[6] Trading Exchange (Green-Up & Tick Ladder)");
{
  // Compri Back a 2.50 con 100€, il prezzo scende a 2.00 (drop) -> Green-up
  const gu = calculateGreenUp({
    backOdds: 2.5,
    backStake: 100,
    layOdds: 2.0,
    commissionPct: 4.5,
    mode: "equal_profit",
  });
  assert(gu !== null, "Green-up calcolato");
  assert(gu !== null && gu.requiredLayStake === 125, `Lay stake richiesto = 125€ (calcolato: ${gu?.requiredLayStake}€)`);
  assert(gu !== null && gu.hedgedProfitNet > 0, `Profitto netto green-up garantito positivo: ${gu?.hedgedProfitNet}€`);
  assert(gu !== null && gu.tickDifference === -25, `Distanza in tick calcolata (-25 tick da 2.50 a 2.00: ${gu?.tickDifference})`);
}

console.log("\n[7] Quote Sintetiche & Correlazione");
{
  const syn = buildSyntheticMarkets(2.1, 3.3, 3.6);
  assert(syn !== null, "Quote sintetiche generate");
  assert(syn !== null && syn.doubleChance.oneX < 2.1, "Doppia Chance 1X inferiore a quota 1");
  assert(syn !== null && syn.drawNoBet.dnb1 < 2.1, "Draw No Bet 1 inferiore a quota 1");

  const disc = detectMarketDiscrepancy({
    offeredSecondaryOdds: 1.65,
    syntheticOdds: 1.45,
    marketName: "DNB",
  });
  assert(disc.hasDiscrepancy === true, "Discrepanza di mercato rilevata (+13.8% edge)");
}

console.log(`\n================================`);
console.log(`Test completati: ${passed} superati | ${failed} falliti`);
console.log(`================================\n`);

if (failed > 0) process.exit(1);
