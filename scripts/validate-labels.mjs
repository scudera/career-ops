#!/usr/bin/env node
// @ts-check
/**
 * validate-labels.mjs — read-only label drift detection.
 *
 * Compara o "(City, Country)" do título display em data/pipeline.md vs
 * `location_real` parseado pelo JSON-LD da JD ao vivo. Não modifica
 * pipeline.md — apenas gera data/label-drift-report-{ts}.md com diff
 * sugerido por linha.
 *
 * GROUND TRUTH (sanity): IQVIA R1519241 (Phenom variant, line ~60) tem
 * label "Oeiras, Portugal / Europe" mas o JSON-LD aponta São Paulo, Brazil
 * — deve aparecer como drift confirmado.
 *
 * SEQUENTIAL: reusa `inspectMany` que é estritamente serial. CP3-advisor
 * Decision #1 documentado em handoff (paralelo não vale a pena pra
 * read-only one-shot de 30 entries).
 *
 * USAGE:
 *   node scripts/validate-labels.mjs           # top 30 unchecked
 *   node scripts/validate-labels.mjs --top 50  # top N unchecked
 *
 * SAÍDA:
 *   stdout: path do report gerado
 *   data/label-drift-report-{YYYY-MM-DD-HHMM}.md
 *
 * Pipeline entry format (parsePipelineEntries em filter-candidates.mjs):
 *   - [ ] URL | Company | Title (Label) [| v2 metadata]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePipelineEntries } from '../filter-candidates.mjs';
import { inspectMany } from './inspect-jds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const OUT_DIR = join(ROOT, 'data');

/**
 * Extract `(City, Country)` substring from title display.
 * Returns the inner content of the LAST parenthetical group, or '' if none.
 * Multi-segment labels separated by '/' are kept whole (primary = first segment
 * after split on '/').
 *
 * Examples:
 *   "Regulatory Affairs Officer (Oeiras, Portugal / Europe)" → "Oeiras, Portugal / Europe"
 *   "Sr Specialist (Remote, EU)"                             → "Remote, EU"
 *   "Reg Affairs Officer 2 , IQVIA Biotech"                  → "" (no paren)
 *
 * @param {string} title
 * @returns {string}
 */
export function extractLabel(title) {
  if (typeof title !== 'string' || !title) return '';
  // Match the LAST (...) group in the title
  const m = title.match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : '';
}

/**
 * Tokenize a location string into normalized comparable tokens. Strips
 * accents, lowercases, splits on commas/slashes/spaces.
 *
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  if (!s) return [];
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[,/\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

/**
 * Heuristic: is the displayed label consistent with the JSON-LD location_real?
 * If either side is empty/sentinel, returns null (cannot compare).
 * Otherwise compares tokens — any shared meaningful token = no drift.
 *
 * @param {string} label    — extracted from title display
 * @param {string} realLoc  — location_real from inspectOne
 * @returns {{drift: boolean|null, reason: string}}
 */
export function compareLabels(label, realLoc) {
  const cleanReal = (realLoc || '').replace(/\(not (in JSON-LD|detected)\)/, '').trim();
  if (!label) return { drift: null, reason: 'no parenthetical label in title' };
  if (!cleanReal) return { drift: null, reason: 'JSON-LD location not extractable' };

  const labelTokens = new Set(tokenize(label));
  const realTokens = tokenize(cleanReal);
  const shared = realTokens.filter((t) => labelTokens.has(t));
  if (shared.length > 0) {
    return { drift: false, reason: `shared tokens: ${shared.slice(0, 3).join(',')}` };
  }
  return { drift: true, reason: `no shared tokens between "${label}" and "${cleanReal}"` };
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function main() {
  const args = process.argv.slice(2);
  let top = 30;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) {
      top = parseInt(args[++i], 10) || 30;
    }
  }

  const raw = readFileSync(PIPELINE_PATH, 'utf8');
  const all = parsePipelineEntries(raw);
  const unchecked = all.filter((e) => !e.checked).slice(0, top);

  process.stderr.write(`[validate-labels] pipeline.md: ${all.length} total entries, ${unchecked.length} selected (top ${top} unchecked)\n`);
  if (unchecked.length === 0) {
    process.stderr.write('No unchecked entries found.\n');
    process.exit(1);
  }

  const urls = unchecked.map((e) => e.url);
  process.stderr.write(`[validate-labels] re-fetching ${urls.length} entries (sequential)...\n`);
  const startedAt = Date.now();
  const results = await inspectMany(urls);
  const elapsedMs = Date.now() - startedAt;
  process.stderr.write(`[validate-labels] done in ${(elapsedMs / 1000).toFixed(1)}s\n`);

  /** @type {Array<{entry: any, result: any, label: string, drift: boolean|null, reason: string}>} */
  const rows = [];
  for (let i = 0; i < unchecked.length; i++) {
    const entry = unchecked[i];
    const result = results[i];
    const label = extractLabel(entry.title);
    const cmp = compareLabels(label, result.location_real);
    rows.push({ entry, result, label, drift: cmp.drift, reason: cmp.reason });
  }

  const driftRows = rows.filter((r) => r.drift === true);
  const okRows = rows.filter((r) => r.drift === false);
  const skippedRows = rows.filter((r) => r.drift === null);
  const errorRows = rows.filter((r) => r.result.error);

  // Top 3 mismatches: drift=true, sorted by line idx ASC
  const topMismatches = driftRows.slice().sort((a, b) => a.entry.idx - b.entry.idx).slice(0, 3);

  const ts = timestamp();
  const outPath = join(OUT_DIR, `label-drift-report-${ts}.md`);
  mkdirSync(OUT_DIR, { recursive: true });

  /** @param {string} s */
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);

  const lines = [];
  lines.push(`# Label Drift Report — ${ts}`);
  lines.push('');
  lines.push(`Generated by: \`scripts/validate-labels.mjs\` (read-only)`);
  lines.push(`Source: \`data/pipeline.md\` (${all.length} entries, top ${top} unchecked re-fetched)`);
  lines.push(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('## Stats');
  lines.push('');
  lines.push(`- **Total checked:** ${rows.length}`);
  lines.push(`- **Drift detected:** ${driftRows.length} (${rows.length ? ((driftRows.length / rows.length) * 100).toFixed(1) : 0}%)`);
  lines.push(`- **Consistent:** ${okRows.length}`);
  lines.push(`- **Skipped (no comparable label or location):** ${skippedRows.length}`);
  lines.push(`- **Fetch errors:** ${errorRows.length}`);
  lines.push('');

  if (topMismatches.length > 0) {
    lines.push('## Top 3 Mismatches (drift confirmed)');
    lines.push('');
    lines.push('| line | label_display | location_real | suggested_fix |');
    lines.push('|---|---|---|---|');
    for (const r of topMismatches) {
      const line = r.entry.idx + 1;
      const suggested = r.result.location_real || '(re-inspect manually)';
      lines.push(`| ${line} | ${esc(r.label)} | ${esc(r.result.location_real)} | replace "(${esc(r.label)})" → "(${esc(suggested)})" |`);
    }
    lines.push('');
  }

  lines.push('## Full Comparison');
  lines.push('');
  lines.push('| line | company | label_display | location_real | drift? | reason |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    const line = r.entry.idx + 1;
    const driftFlag = r.drift === true ? '⚠️ YES' : r.drift === false ? '✓ no' : '— skip';
    lines.push(`| ${line} | ${esc(r.entry.company)} | ${esc(r.label)} | ${esc(r.result.location_real)} | ${driftFlag} | ${esc(r.reason)} |`);
  }
  lines.push('');

  if (errorRows.length > 0) {
    lines.push('## Fetch Errors');
    lines.push('');
    for (const r of errorRows) {
      lines.push(`- line ${r.entry.idx + 1}: ${r.entry.url} — ${esc(r.result.error)}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**NÃO** aplicar fixes automaticamente. Esta é uma view diagnóstica — Vitor revisa drift candidates e edita pipeline.md manualmente.');
  lines.push('');

  writeFileSync(outPath, lines.join('\n'), 'utf8');
  process.stdout.write(outPath + '\n');
  process.stderr.write(`[validate-labels] report written: ${outPath}\n`);
  process.stderr.write(`  total=${rows.length} drift=${driftRows.length} ok=${okRows.length} skip=${skippedRows.length} err=${errorRows.length}\n`);
}

const isMain = (() => {
  try {
    const here = new URL(import.meta.url).pathname;
    const argv1 = String(process.argv[1] || '').replace(/\\/g, '/');
    return here.endsWith(argv1) || argv1.endsWith(here);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e) => { process.stderr.write(`Fatal: ${e.message}\n${e.stack || ''}\n`); process.exit(1); });
}
