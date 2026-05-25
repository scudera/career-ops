#!/usr/bin/env node
// @ts-check
/**
 * cp5-fase-c-gupy-revalidate.mjs — COTSK-6 Fase C.
 *
 * Re-roda pre-apply-check.mjs nas 3 Gupy URLs (Brainfarma 203, Cristália 210,
 * MCassab 211) que falharam em CP4 com liveness=uncertain. Espera-se que pós
 * Fase B (PT-BR APPLY_PATTERNS) liveness=active e classifyWithConsensus dispara.
 *
 * PASS criteria por entry: tier=3, work_mode=ON_SITE, br_eligible=BR_OK,
 * confidence ∈ {unanimous, majority}.
 *
 * Outputs: data/cp5-fase-c-entry-{02,03,04}.{json,stderr.log}
 *         + data/cp5-fase-c-smoke-{ts}.md
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'data');

const ENTRIES = [
  { n: 2, line: 203, company: 'Brainfarma (Gupy)', role: 'Analista de Assuntos Regulatórios SÊNIOR', url: 'https://brainfarma.gupy.io/job/eyJqb2JJZCI6MTEyMjQxNjAsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs' },
  { n: 3, line: 210, company: 'Cristália (Gupy)', role: 'Analista de Assuntos Regulatórios Pl', url: 'https://cristalia.gupy.io/job/eyJqb2JJZCI6MTExNTI0MzUsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs' },
  { n: 4, line: 211, company: 'MCassab (Gupy)', role: 'Supervisor de Assuntos Regulatórios', url: 'https://mcassabnutricaoesaudeanimal.gupy.io/job/eyJqb2JJZCI6MTA4NTcxNTcsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs' },
];

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function runPreApply(n, url) {
  const t0 = Date.now();
  const result = spawnSync('node', [join(ROOT, 'pre-apply-check.mjs'), url], {
    env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const elapsedMs = Date.now() - t0;
  const nn = String(n).padStart(2, '0');
  writeFileSync(join(OUT_DIR, `cp5-fase-c-entry-${nn}.json`), result.stdout || '', 'utf8');
  writeFileSync(join(OUT_DIR, `cp5-fase-c-entry-${nn}.stderr.log`), result.stderr || '', 'utf8');
  if (result.error) return { json: null, elapsedMs, error: String(result.error.message || result.error) };
  if (result.status !== 0 && result.status !== 1 && result.status !== 2) return { json: null, elapsedMs, error: `exit code ${result.status}` };
  try {
    const json = JSON.parse((result.stdout || '').trim());
    return { json, elapsedMs, error: null };
  } catch (err) {
    return { json: null, elapsedMs, error: `JSON parse error: ${err.message}` };
  }
}

function evaluate(json) {
  if (!json) return { pass: false, reason: 'no JSON output' };
  if (json.result !== 'active') return { pass: false, reason: `liveness=${json.result} (${json.reason})` };
  const enr = json.enriched;
  if (!enr || enr.error) return { pass: false, reason: `enriched missing or error: ${enr?.error || '(absent)'}` };
  const obs = { tier: enr.tier, work_mode: enr.work_mode, br_eligible: enr.br_eligible, confidence: enr.consensus?.confidence };
  // PASS: tier=3, work_mode=ON_SITE, br_eligible=BR_OK
  if (obs.tier !== 3) return { pass: false, reason: `tier=${obs.tier} != 3`, obs };
  if (obs.work_mode !== 'ON_SITE') return { pass: false, reason: `work_mode=${obs.work_mode} != ON_SITE`, obs };
  if (obs.br_eligible !== 'BR_OK') return { pass: false, reason: `br_eligible=${obs.br_eligible} != BR_OK`, obs };
  if (obs.confidence === 'split-fallback-conservative') return { pass: false, reason: `confidence=${obs.confidence}`, obs };
  return { pass: true, reason: 'all criteria match', obs };
}

const results = [];
const t0 = Date.now();
for (const e of ENTRIES) {
  process.stderr.write(`[${e.n}/${ENTRIES.length}] ${e.company} — ${e.role.slice(0, 50)}\n`);
  const r = runPreApply(e.n, e.url);
  const v = r.error ? { pass: false, reason: `runner error: ${r.error}` } : evaluate(r.json);
  results.push({ entry: e, json: r.json, elapsedMs: r.elapsedMs, verdict: v });
  const status = v.pass ? '✅ PASS' : '❌ FAIL';
  process.stderr.write(`  ${status} in ${(r.elapsedMs / 1000).toFixed(1)}s — ${v.reason}\n`);
}
const elapsedTotal = Date.now() - t0;
const passCount = results.filter((r) => r.verdict.pass).length;
const overall = passCount === results.length ? 'PASS' : 'FAIL';

const ts = timestamp();
const outPath = join(OUT_DIR, `cp5-fase-c-smoke-${ts}.md`);
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);

const lines = [];
lines.push(`# CP5 Fase C — Gupy re-validation post-liveness-fix (${ts})`);
lines.push('');
lines.push(`## Verdict: **${overall}** (${passCount}/${results.length})`);
lines.push('');
lines.push(`Total elapsed: ${(elapsedTotal / 1000).toFixed(1)}s`);
lines.push('');
lines.push('| # | line | company | tier | work_mode | br_eligible | confidence | verdict | reason |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const obs = r.verdict.obs || {};
  lines.push(`| ${r.entry.n} | ${r.entry.line} | ${esc(r.entry.company)} | ${obs.tier ?? '-'} | ${esc(obs.work_mode || '-')} | ${esc(obs.br_eligible || '-')} | ${esc(obs.confidence || '-')} | ${r.verdict.pass ? '✅' : '❌'} | ${esc(r.verdict.reason)} |`);
}
lines.push('');

const confDist = {};
for (const r of results) {
  const c = r.verdict.obs?.confidence || '(no consensus data)';
  confDist[c] = (confDist[c] || 0) + 1;
}
lines.push('## Consensus distribution');
lines.push('');
for (const [c, n] of Object.entries(confDist)) lines.push(`- ${c}: ${n}`);
lines.push('');

writeFileSync(outPath, lines.join('\n'), 'utf8');
process.stderr.write(`\n[cp5-fase-c] report: ${outPath}\n`);
process.stdout.write(JSON.stringify({ verdict: overall, pass: passCount, total: results.length, reportPath: outPath, confDist }, null, 2));
