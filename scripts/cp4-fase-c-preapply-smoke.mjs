#!/usr/bin/env node
// @ts-check
/**
 * cp4-fase-c-preapply-smoke.mjs — COTSK-5 Fase C end-to-end smoke test.
 *
 * Runs `pre-apply-check.mjs` serially against the 12 ground-truth URLs
 * (per data/cp4-ground-truth-expanded.md), captures JSON output per entry
 * to data/cp4-fase-c-entry-{N}.json, then evaluates PASS/FAIL per entry
 * vs the expected (tier, work_mode, br_eligible) ground truth.
 *
 * pre-apply-check.mjs already uses classifyWithConsensus internally for
 * any ACTIVE entry (CP3.5 Fase A wired ALWAYS-consensus). No --consensus
 * flag needed.
 *
 * Per-entry latency budget: ~12-15s (3 consensus runs). Total: ~3min.
 *
 * Output: data/cp4-fase-c-smoke-{ts}.md with verdict + diff table.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'data');
mkdirSync(OUT_DIR, { recursive: true });

/**
 * @typedef {object} GroundTruthEntry
 * @property {number} n
 * @property {number} line
 * @property {string} company
 * @property {string} role
 * @property {string} url
 * @property {number|number[]} expectedTier
 * @property {string} expectedWorkMode   // 'varies' = don't check
 * @property {string} expectedBrEligible // 'varies' = don't check
 * @property {string|null} confidenceFloor // 'majority' min for IQVIA
 * @property {string} criterionNote
 */

/** @type {GroundTruthEntry[]} */
const GROUND_TRUTH = [
  { n: 1, line: 60, company: 'IQVIA Biotech', role: 'Regulatory Affairs Officer', url: 'https://jobs.iqvia.com/en/jobs/R1519241-0', expectedTier: [1, 3], expectedWorkMode: 'varies', expectedBrEligible: 'varies', confidenceFloor: 'majority', criterionNote: 'Tier in {1,3} AND confidence != split-fallback-conservative' },
  { n: 2, line: 203, company: 'Brainfarma (Gupy)', role: 'Analista de Assuntos Regulatórios SÊNIOR', url: 'https://brainfarma.gupy.io/job/eyJqb2JJZCI6MTEyMjQxNjAsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs', expectedTier: 3, expectedWorkMode: 'ON_SITE', expectedBrEligible: 'BR_OK', confidenceFloor: null, criterionNote: 'Tier=3 ON_SITE BR_OK exact (Gupy enum-vs-live-JD divergence caveat applies)' },
  { n: 3, line: 210, company: 'Cristália (Gupy)', role: 'Analista de Assuntos Regulatórios Pl', url: 'https://cristalia.gupy.io/job/eyJqb2JJZCI6MTExNTI0MzUsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs', expectedTier: 3, expectedWorkMode: 'ON_SITE', expectedBrEligible: 'BR_OK', confidenceFloor: null, criterionNote: 'Tier=3 ON_SITE BR_OK exact (Gupy enum-vs-live-JD divergence caveat applies)' },
  { n: 4, line: 211, company: 'MCassab (Gupy)', role: 'Supervisor de Assuntos Regulatórios', url: 'https://mcassabnutricaoesaudeanimal.gupy.io/job/eyJqb2JJZCI6MTA4NTcxNTcsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs', expectedTier: 3, expectedWorkMode: 'ON_SITE', expectedBrEligible: 'BR_OK', confidenceFloor: null, criterionNote: 'Tier=3 ON_SITE BR_OK exact (Gupy enum-vs-live-JD divergence caveat applies)' },
  { n: 5, line: 214, company: 'PPD (Thermo Fisher)', role: 'Regulatory Affairs Manager Transplant Diagnostics', url: 'https://jobs.thermofisher.com/global/en/job/R-01351891/Regulatory-Affairs-Manager-Transplant-Diagnostics', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED (geo-restricted PPD)' },
  { n: 6, line: 215, company: 'PPD (Thermo Fisher)', role: 'Supervisor Regulatory Affairs', url: 'https://jobs.thermofisher.com/global/en/job/R-01346292/Supervisor-Regulatory-Affairs', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED' },
  { n: 7, line: 217, company: 'PPD (Thermo Fisher)', role: 'Principal Regulatory Affairs Specialist Global CTA', url: 'https://jobs.thermofisher.com/global/en/job/R-01350715/Principal-Regulatory-Affairs-Specialist-Global-Clinical-Trial-Applications', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED' },
  { n: 8, line: 219, company: 'PPD (Thermo Fisher)', role: 'Regulatory Affairs Specialist', url: 'https://jobs.thermofisher.com/global/en/job/R-01352337/Regulatory-Affairs-Specialist', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED' },
  { n: 9, line: 220, company: 'PPD (Thermo Fisher)', role: 'Regulatory Affairs Manager Global CTA', url: 'https://jobs.thermofisher.com/global/en/job/R-01351430/Regulatory-Affairs-Manager-Global-Clinical-Trial-Applications', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED' },
  { n: 10, line: 221, company: 'PPD (Thermo Fisher)', role: 'Regulatory Affairs Specialist II', url: 'https://jobs.thermofisher.com/global/en/job/R-01351974/Regulatory-Affairs-Specialist-II', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED' },
  { n: 11, line: 223, company: 'PPD (Thermo Fisher)', role: 'Regulatory Affairs Specialist II IVD Medical Devices', url: 'https://jobs.thermofisher.com/global/en/job/R-01341889/Regulatory-Affairs-Specialist-II-IVD-Medical-Devices', expectedTier: 2, expectedWorkMode: 'HYBRID', expectedBrEligible: 'BR_OK', confidenceFloor: null, criterionNote: 'Tier=2 HYBRID BR_OK exact (determinístico)' },
  { n: 12, line: 224, company: 'PPD (Thermo Fisher)', role: 'Regulatory Affairs Specialist III Animal Health', url: 'https://jobs.thermofisher.com/global/en/job/R-01333958/Regulatory-Affairs-Specialist-III-Animal-Health', expectedTier: 4, expectedWorkMode: 'varies', expectedBrEligible: 'RELOCATION_REQUIRED', confidenceFloor: null, criterionNote: 'Tier=4 + br_eligible=RELOCATION_REQUIRED' },
];

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Run pre-apply-check.mjs on a URL, capture JSON + stderr.
 * Returns parsed JSON, total elapsed ms, and any error.
 */
function runPreApply(n, url) {
  const t0 = Date.now();
  const stdoutPath = join(OUT_DIR, `cp4-fase-c-entry-${String(n).padStart(2, '0')}.json`);
  const stderrPath = join(OUT_DIR, `cp4-fase-c-entry-${String(n).padStart(2, '0')}.stderr.log`);
  // Don't use shell — pass args directly to node.
  const result = spawnSync('node', [join(ROOT, 'pre-apply-check.mjs'), url], {
    env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const elapsedMs = Date.now() - t0;
  writeFileSync(stdoutPath, result.stdout || '', 'utf8');
  writeFileSync(stderrPath, result.stderr || '', 'utf8');
  if (result.error) {
    return { json: null, elapsedMs, error: String(result.error.message || result.error) };
  }
  if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
    return { json: null, elapsedMs, error: `exit code ${result.status}` };
  }
  let json;
  try {
    // pre-apply-check stdout ends with \n; tolerate trailing whitespace
    json = JSON.parse((result.stdout || '').trim());
  } catch (err) {
    return { json: null, elapsedMs, error: `JSON parse error: ${err.message}` };
  }
  return { json, elapsedMs, error: null };
}

/**
 * Evaluate PASS/FAIL per ground-truth entry.
 */
function evaluate(entry, json) {
  if (!json) return { pass: false, reason: 'no JSON output' };
  if (json.result !== 'active') return { pass: false, reason: `liveness=${json.result} (${json.reason})` };
  const enr = json.enriched;
  if (!enr || enr.error) return { pass: false, reason: `enriched missing or error: ${enr?.error || '(absent)'}` };

  const obs = { tier: enr.tier, work_mode: enr.work_mode, br_eligible: enr.br_eligible, confidence: enr.consensus?.confidence };

  // Tier check
  const expectedTiers = Array.isArray(entry.expectedTier) ? entry.expectedTier : [entry.expectedTier];
  if (!expectedTiers.includes(obs.tier)) {
    return { pass: false, reason: `tier=${obs.tier} not in expected ${JSON.stringify(expectedTiers)}`, obs };
  }
  // Confidence floor (IQVIA only)
  if (entry.confidenceFloor) {
    if (obs.confidence === 'split-fallback-conservative') {
      return { pass: false, reason: `confidence=${obs.confidence} below floor ${entry.confidenceFloor}`, obs };
    }
  }
  // Work mode exact (skip 'varies')
  if (entry.expectedWorkMode !== 'varies' && obs.work_mode !== entry.expectedWorkMode) {
    return { pass: false, reason: `work_mode=${obs.work_mode} != expected ${entry.expectedWorkMode}`, obs };
  }
  // br_eligible exact (skip 'varies')
  if (entry.expectedBrEligible !== 'varies' && obs.br_eligible !== entry.expectedBrEligible) {
    return { pass: false, reason: `br_eligible=${obs.br_eligible} != expected ${entry.expectedBrEligible}`, obs };
  }
  return { pass: true, reason: 'all criteria match', obs };
}

async function main() {
  process.stderr.write(`[cp4-fase-c] running pre-apply on ${GROUND_TRUTH.length} ground-truth entries...\n`);
  /** @type {Array<{entry: GroundTruthEntry, json: any, elapsedMs: number, error: string|null, verdict: any}>} */
  const results = [];
  const overallStart = Date.now();
  for (const entry of GROUND_TRUTH) {
    process.stderr.write(`[${entry.n}/${GROUND_TRUTH.length}] ${entry.company} — ${entry.role.slice(0, 50)}\n`);
    const { json, elapsedMs, error } = runPreApply(entry.n, entry.url);
    const verdict = error ? { pass: false, reason: `runner error: ${error}` } : evaluate(entry, json);
    results.push({ entry, json, elapsedMs, error, verdict });
    const status = verdict.pass ? '✅ PASS' : '❌ FAIL';
    process.stderr.write(`  ${status} in ${(elapsedMs / 1000).toFixed(1)}s — ${verdict.reason}\n`);
  }
  const totalElapsed = Date.now() - overallStart;

  const passCount = results.filter((r) => r.verdict.pass).length;
  const failCount = results.length - passCount;
  const overall = passCount === results.length ? 'PASS' : 'FAIL';

  // Write report
  const ts = timestamp();
  const outPath = join(OUT_DIR, `cp4-fase-c-smoke-${ts}.md`);
  /** @param {string} s */
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);

  const lines = [];
  lines.push(`# CP4 Fase C — End-to-End Smoke Test (${ts})`);
  lines.push('');
  lines.push(`## Verdict: **${overall}** (${passCount}/${results.length} passed)`);
  lines.push('');
  lines.push(`Total elapsed: ${(totalElapsed / 1000).toFixed(1)}s (avg ${(totalElapsed / results.length / 1000).toFixed(1)}s/entry)`);
  lines.push('');
  lines.push('Per-entry artifacts: `data/cp4-fase-c-entry-NN.json` + `.stderr.log`');
  lines.push('Ground truth: `data/cp4-ground-truth-expanded.md`');
  lines.push('');
  lines.push('## Per-entry diff table');
  lines.push('');
  lines.push('| # | line | company | expected | observed | confidence | verdict | reason |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const expected = `T${JSON.stringify(r.entry.expectedTier)} / ${r.entry.expectedWorkMode} / ${r.entry.expectedBrEligible}`;
    const obs = r.verdict.obs ? `T${r.verdict.obs.tier} / ${r.verdict.obs.work_mode} / ${r.verdict.obs.br_eligible}` : '(no obs)';
    const conf = r.verdict.obs?.confidence || '-';
    const v = r.verdict.pass ? '✅' : '❌';
    lines.push(`| ${r.entry.n} | ${r.entry.line} | ${esc(r.entry.company)} | ${esc(expected)} | ${esc(obs)} | ${esc(conf)} | ${v} | ${esc(r.verdict.reason)} |`);
  }
  lines.push('');

  // Consensus distribution
  const confDist = {};
  for (const r of results) {
    const c = r.verdict.obs?.confidence || '(no consensus data)';
    confDist[c] = (confDist[c] || 0) + 1;
  }
  lines.push('## Consensus confidence distribution');
  lines.push('');
  for (const [c, n] of Object.entries(confDist)) lines.push(`- ${c}: ${n}`);
  lines.push('');

  // Errors / failure details
  const failed = results.filter((r) => !r.verdict.pass);
  if (failed.length > 0) {
    lines.push('## Failure details');
    lines.push('');
    for (const r of failed) {
      lines.push(`### Entry ${r.entry.n} (line ${r.entry.line}) — ${r.entry.company}`);
      lines.push('');
      lines.push(`- URL: ${r.entry.url}`);
      lines.push(`- Criterion: ${r.entry.criterionNote}`);
      lines.push(`- Reason: ${r.verdict.reason}`);
      if (r.json?.enriched) {
        lines.push(`- enriched.tier=${r.json.enriched.tier}`);
        lines.push(`- enriched.work_mode=${r.json.enriched.work_mode}`);
        lines.push(`- enriched.br_eligible=${r.json.enriched.br_eligible}`);
        lines.push(`- enriched.location_real=${r.json.enriched.location_real}`);
        lines.push(`- enriched.evidence=${r.json.enriched.evidence}`);
        if (r.json.enriched.consensus) {
          lines.push(`- consensus.tierDistribution=${JSON.stringify(r.json.enriched.consensus.tierDistribution)}`);
          lines.push(`- consensus.confidence=${r.json.enriched.consensus.confidence}`);
        }
      }
      lines.push('');
    }
  }

  writeFileSync(outPath, lines.join('\n'), 'utf8');
  process.stderr.write(`\n[cp4-fase-c] report written: ${outPath}\n`);
  process.stderr.write(`[cp4-fase-c] verdict=${overall} pass=${passCount}/${results.length}\n`);
  process.stdout.write(JSON.stringify({ verdict: overall, pass: passCount, total: results.length, reportPath: outPath, confDist }, null, 2));
}

main().catch((e) => { process.stderr.write(`Fatal: ${e.message}\n${e.stack}\n`); process.exit(1); });
