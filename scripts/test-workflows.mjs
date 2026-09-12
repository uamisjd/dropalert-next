import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { load } from "js-yaml";

const base = {
  ...process.env, INPUT_WHICH: "both", INPUT_MODE: "trova-partita",
  INPUT_MATCH_ID: "", INPUT_HOURS: "72", INPUT_SPORT_KEY: "",
};
let checks = 0;
function valid(mode, env, expected) {
  const result = spawnSync("bash", ["scripts/validate-workflow-inputs.sh", mode], { env: { ...base, ...env }, encoding: "utf8" });
  assert.equal(result.status === 0, expected, `${mode}: ${JSON.stringify(env)}\n${result.stderr}`);
  checks++;
}
for (const mode of ["audit", "smoke"]) {
  valid(mode, {}, true);
  valid(mode, { INPUT_MATCH_ID: "2147483647", INPUT_HOURS: "720", INPUT_SPORT_KEY: "soccer_italy_serie_a" }, true);
  for (const value of ["0", "-1", "01", "1.5", "2147483648", "1; exit 0", "$(exit 0)", "1\n2", "--help", "9".repeat(100)]) {
    valid(mode, { INPUT_MATCH_ID: value }, false);
  }
  for (const value of ["", "0", "721", "01", "1e2", "$(exit 0)", "48 72"]) valid(mode, { INPUT_HOURS: value }, false);
  for (const value of ["soccer_", "basketball_nba", "soccer_a; exit 0", "soccer_a\nb", "--help"]) valid(mode, { INPUT_SPORT_KEY: value }, false);
}
valid("audit", { INPUT_WHICH: "smoke-wire" }, true);
valid("audit", { INPUT_WHICH: "unknown" }, false);
valid("smoke", { INPUT_MODE: "smoke-test" }, false);
valid("smoke", { INPUT_MODE: "smoke-test", INPUT_MATCH_ID: "123" }, true);
valid("rebase", { INPUT_MODE: "dry-run" }, true);
valid("rebase", { INPUT_MODE: "apply" }, true);
valid("rebase", { INPUT_MODE: "apply; exit 0" }, false);

const workflows = {};
for (const file of readdirSync(".github/workflows").filter((p) => p.endsWith(".yml"))) {
  const workflow = load(readFileSync(`.github/workflows/${file}`, "utf8"));
  workflows[file] = workflow;
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (!step.run) continue;
      assert.ok(!/\$\{\{[^}]*\binputs\./.test(step.run), `${file}: input interpolato nella shell`);
      const syntax = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
      assert.equal(syntax.status, 0, `${file}: ${step.name}\n${syntax.stderr}`);
      checks++;
    }
  }
}

// Esegue i blocchi veri, ma sostituisce npm: nessun DB, provider o credito.
const dir = mkdtempSync(join(tmpdir(), "dropalert-workflows-"));
try {
  let sequence = 0;
  function run(workflow, jobName, stepName, env, expectedArgs, exit = 0) {
    const step = workflows[workflow].jobs[jobName].steps.find((s) => s.name === stepName);
    assert.ok(step);
    const calls = join(dir, `calls-${sequence++}`);
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", `
      npm() { printf '%s\\0' "$@" >> "$MOCK_CALLS"; return "$MOCK_EXIT"; }
      ${step.run}
    `], {
      encoding: "utf8",
      env: { ...base, ...env, THE_ODDS_API_KEY: "fake", MOCK_CALLS: calls, MOCK_EXIT: String(exit), GITHUB_STEP_SUMMARY: join(dir, "summary") },
    });
    assert.equal(result.status, exit, `${stepName}: ${result.stderr}`);
    const args = readFileSync(calls, "utf8").split("\0").slice(0, -1);
    assert.deepEqual(args, expectedArgs, stepName);
    checks++;
  }
  run("audit.yml", "audit", "Smoke The Odds API", { INPUT_MATCH_ID: "123", INPUT_SPORT_KEY: "soccer_spl" }, ["run", "smoke:odds-api", "--", "--match-id", "123", "--sport-key", "soccer_spl"]);
  run("audit.yml", "audit", "Smoke The Odds API", {}, ["run", "odds:find", "--", "--ore", "72"]);
  run("audit.yml", "audit", "Smoke The Odds API", { INPUT_SPORT_KEY: "soccer_spl" }, ["run", "odds:find", "--", "--sonda", "soccer_spl"]);
  run("audit.yml", "audit", "Smoke cablaggio per-bookmaker", { INPUT_MATCH_ID: "123" }, ["run", "smoke:odds-wire", "--", "--read", "123"], 7);
  run("audit.yml", "audit", "Smoke cablaggio per-bookmaker", {}, ["run", "smoke:odds-wire"]);
  run("audit.yml", "audit", "Sguardo sui dati (read-only)", {}, ["run", "audit:value-bets", "run", "audit:finished"]);
  // L’aggregatore converte qualunque errore in exit 1, ma esegue entrambi gli audit.
  run("audit.yml", "audit", "Sguardo sui dati (read-only)", {}, ["run", "audit:value-bets", "run", "audit:finished"], 1);
  run("audit.yml", "audit", "Lettura di controllo (produzione)", { INPUT_SPORT_KEY: "soccer_spl" }, ["run", "odds:control", "--", "--ore", "72", "--sport-key", "soccer_spl"], 7);
  run("smoke-odds.yml", "smoke", "Smoke test live (1 credito)", { INPUT_MATCH_ID: "123" }, ["run", "smoke:odds-api", "--", "--match-id", "123"]);
  const rebaseStep = workflows["rebase-clv.yml"].jobs.rebase.steps.find((s) => s.name.startsWith("Ribasatura ("));
  run("rebase-clv.yml", "rebase", rebaseStep.name, { INPUT_MODE: "dry-run" }, ["run", "clv:rebase", "--"]);
  run("rebase-clv.yml", "rebase", rebaseStep.name, { INPUT_MODE: "apply" }, ["run", "clv:rebase", "--", "--apply"], 7);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`✓ ${checks} verifiche workflow: input, sintassi, argomenti e propagazione errori`);
