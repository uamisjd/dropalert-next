import { assessDecision, type DecisionInput } from "../contract";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

const base = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  now: new Date("2026-09-06T10:00:00.000Z"),
  kickoffAt: new Date("2026-09-06T12:00:00.000Z"),
  priceAgeMinutes: 5,
  maxPriceAgeMinutes: 15,
  currentPrice: 2.2,
  priceSource: "bookmaker",
  marketComplete: true,
  fairProbability: 0.5,
  fairSource: "independent_sharp",
  edgePct: 10,
  minimumEdgePct: 2,
  movement: {
    observed: true,
    dropPct: -8,
    durationMinutes: 90,
    isFlash: false,
    rebounded: false,
    directionCoherent: true,
    hoursToKickoff: 2,
  },
  context: { status: "available", newsCount: 2 },
  sharpAvailable: true,
  sharpConfirmed: true,
  validation: {
    sampleSize: 12,
    minimumSampleSize: 30,
    outOfSamplePassed: false,
    clvPositive: false,
    calibrationPassed: false,
  },
  ...overrides,
});

console.log("\nContratto decisionale\n");

{
  const result = assessDecision(base({ priceSource: "consensus" }));
  assert(result.state === "NON_AZIONABILE", "il consenso non diventa prezzo eseguibile");
  assert(
    result.reasons.some((r) => r.code === "PRICE_NOT_EXECUTABLE"),
    "il motivo del consenso è visibile",
  );
}

{
  const result = assessDecision(base({ marketComplete: false }));
  assert(result.state === "NON_AZIONABILE", "mercato incompleto = hard gate");
  assert(
    result.reasons.some((r) => r.code === "INCOMPLETE_MARKET"),
    "la fair non viene calcolata su mercato incompleto",
  );
}

{
  const result = assessDecision(base({ fairSource: "same_line" }));
  assert(result.state === "OSSERVAZIONE", "no-vig della stessa linea resta osservazione");
  assert(
    result.reasons.some((r) => r.code === "MISSING_INDEPENDENT_FAIR"),
    "manca fair indipendente: il motivo non è una smentita",
  );
}

{
  const result = assessDecision(base());
  assert(result.state === "CANDIDATA", "dati eseguibili e fair indipendente = candidata");
  assert(result.warnings.length === 4, "la candidata conserva tutti i gap di validazione");
}

{
  const result = assessDecision(
    base({
      validation: {
        sampleSize: 30,
        minimumSampleSize: 30,
        outOfSamplePassed: true,
        clvPositive: true,
        calibrationPassed: true,
      },
    }),
  );
  assert(result.state === "VALORE_VERIFICATO", "solo la validazione completa promuove lo stato");
}

{
  const result = assessDecision(base({ kickoffAt: new Date("2026-09-06T09:59:00.000Z") }));
  assert(result.state === "NON_AZIONABILE", "kickoff passato = non azionabile");
  assert(
    result.reasons.some((r) => r.code === "KICKOFF_PASSED"),
    "il kickoff passato ha il suo motivo dedicato",
  );
}

{
  const result = assessDecision(
    base({
      movement: {
        observed: true,
        dropPct: -8,
        durationMinutes: 20,
        isFlash: true,
        rebounded: true,
        directionCoherent: true,
        hoursToKickoff: 1,
      },
      context: { status: "empty", newsCount: 0 },
    }),
  );
  assert(result.state === "OSSERVAZIONE", "rimbalzo = osservazione, non ingresso");
  assert(
    result.reasons.some((r) => r.code === "MOVEMENT_REBOUNDED"),
    "la forma del movimento entra nel motivo",
  );
  assert(result.warnings.length === 1, "news vuote sono una warning, non una conferma");
}

console.log(`\n${passed} test superati | ${failed} falliti\n`);
if (failed > 0) process.exit(1);
