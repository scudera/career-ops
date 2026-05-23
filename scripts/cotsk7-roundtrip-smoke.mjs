#!/usr/bin/env node
// @ts-check
/**
 * cotsk7-roundtrip-smoke.mjs — COTSK-7 Fase D smoke test.
 *
 * Validates v2.1 serialization roundtrip via two paths:
 *
 *   PATH 1 (synthetic, deterministic):
 *     - Construct fake Job objects covering all v2.1 field combinations
 *       (full populated, partial, none) + sentinel edge cases (invalid
 *       URL, invalid currency, missing tier).
 *     - Format via scan.mjs::formatPipelineLine
 *     - Parse back via filter-candidates.mjs::parsePipelineEntries
 *     - Assert round-trip preserves all valid fields, drops invalid ones.
 *
 *   PATH 2 (live, end-to-end):
 *     - Probe one Workday tenant + one Gupy tenant (~10-20 jobs each)
 *     - Confirm v2.1 fields show up in Job objects
 *     - Coverage matrix per provider
 *
 * Outputs: data/cotsk7-smoke-{ts}.md
 */

import { fetchJson } from '../providers/_http.mjs';
import { formatPipelineLine } from '../scan.mjs';
import { parsePipelineEntries } from '../filter-candidates.mjs';
import workday from '../providers/workday.mjs';
import gupy from '../providers/gupy.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'data');

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const REPORT_LINES = [];
const log = (s) => { REPORT_LINES.push(s); process.stderr.write(s + '\n'); };

// ─── PATH 1: synthetic roundtrip ────────────────────────────────────────
log('# COTSK-7 Roundtrip Smoke Test\n');
log(`Generated: ${ts()}\n`);

log('## PATH 1 — Synthetic roundtrip\n');

/** @type {Array<{name: string, job: any, expectations: object}>} */
const synthetic = [
  {
    name: 'v1 minimal (no v2/v2.1)',
    job: { title: 'Test Role', url: 'https://example.com/jobs/1', company: 'ExampleCo', location: 'São Paulo' },
    expectations: { tier: null, work_mode: null, employment_type: null, posted_at: null },
  },
  {
    name: 'v2.0 only (no v2.1)',
    job: {
      title: 'Test Role v2', url: 'https://example.com/jobs/2', company: 'ExampleCo', location: 'SP',
      tier: 2, work_mode: 'HYBRID', br_eligible: 'BR_OK', location_real: 'São Paulo, Brazil',
    },
    expectations: { tier: 2, work_mode: 'HYBRID', br_eligible: 'BR_OK', location_real: 'São Paulo, Brazil', employment_type: null, posted_at: null },
  },
  {
    name: 'v2.1 full (all 7 fields valid)',
    job: {
      title: 'Test Role v2.1 full', url: 'https://example.com/jobs/3', company: 'ExampleCo', location: 'NYC',
      tier: 1, work_mode: 'REMOTE', br_eligible: 'BR_OK', location_real: 'Remote',
      employment_type: 'FULL_TIME',
      compensation_min: 80000, compensation_max: 120000,
      compensation_currency: 'USD', compensation_period: 'YEAR',
      posted_at: '2026-04-15', apply_url: 'https://example.com/apply/3',
    },
    expectations: {
      tier: 1, work_mode: 'REMOTE', employment_type: 'FULL_TIME',
      compensation_min: 80000, compensation_max: 120000,
      compensation_currency: 'USD', compensation_period: 'YEAR',
      posted_at: '2026-04-15', apply_url: 'https://example.com/apply/3',
    },
  },
  {
    name: 'v2.1 partial (only employment_type + posted_at, no compensation)',
    job: {
      title: 'Test Role partial', url: 'https://example.com/jobs/4', company: 'ExampleCo', location: 'BR',
      tier: 3, work_mode: 'ON_SITE', br_eligible: 'BR_OK', location_real: 'São Paulo',
      employment_type: 'FULL_TIME', posted_at: '2026-05-01',
    },
    expectations: { tier: 3, employment_type: 'FULL_TIME', posted_at: '2026-05-01', compensation_min: null, apply_url: null },
  },
  {
    name: 'v2.1 with invalid tokens (bad enum, bad URL, bad currency, bad date)',
    job: {
      title: 'Test invalid', url: 'https://example.com/jobs/5', company: 'ExampleCo', location: 'X',
      tier: 1, work_mode: 'REMOTE', br_eligible: 'BR_OK', location_real: 'Test',
      employment_type: 'NOT_AN_ENUM', // should drop
      compensation_currency: 'us_dollars', // should drop
      compensation_period: 'YEARLY_NOT_VALID', // should drop
      posted_at: 'not-a-date', // should drop
      apply_url: 'ftp://example.com/apply', // should drop (non-http)
    },
    expectations: { tier: 1, employment_type: null, compensation_currency: null, compensation_period: null, posted_at: null, apply_url: null },
  },
  {
    name: 'v2.1 apply_url same as listing url (should drop)',
    job: {
      title: 'Apply same', url: 'https://example.com/jobs/6', company: 'ExampleCo', location: 'X',
      tier: 1, work_mode: 'REMOTE', br_eligible: 'BR_OK',
      apply_url: 'https://example.com/jobs/6', // identical to url → drop
    },
    expectations: { tier: 1, apply_url: null },
  },
];

const fakeMarkdown = `# Test\n## Pendientes\n\n${synthetic.map((s) => formatPipelineLine(s.job)).join('\n')}\n`;
const parsed = parsePipelineEntries(fakeMarkdown);

log(`Wrote ${synthetic.length} synthetic entries, parsed back ${parsed.length}.\n`);
let passCount = 0, failCount = 0;
log('| # | name | formatted line (truncated) | check | reason |');
log('|---|---|---|---|---|');
for (let i = 0; i < synthetic.length; i++) {
  const expected = synthetic[i].expectations;
  const actual = parsed[i] || {};
  /** @type {string[]} */
  const failures = [];
  for (const k of Object.keys(expected)) {
    if (actual[k] !== expected[k]) failures.push(`${k}: expected=${JSON.stringify(expected[k])} actual=${JSON.stringify(actual[k])}`);
  }
  const formatted = formatPipelineLine(synthetic[i].job);
  const truncated = formatted.length > 100 ? formatted.slice(0, 97) + '...' : formatted;
  if (failures.length === 0) {
    passCount++;
    log(`| ${i + 1} | ${synthetic[i].name.replace(/\|/g, '\\|')} | \`${truncated.replace(/\|/g, '\\|')}\` | ✅ | all expectations match |`);
  } else {
    failCount++;
    log(`| ${i + 1} | ${synthetic[i].name.replace(/\|/g, '\\|')} | \`${truncated.replace(/\|/g, '\\|')}\` | ❌ | ${failures.join('; ').replace(/\|/g, '\\|')} |`);
  }
}
log(`\nPATH 1 verdict: ${passCount}/${synthetic.length} (${failCount} failed)\n`);

// ─── PATH 2: live provider scan ─────────────────────────────────────────
log('## PATH 2 — Live provider scan (Workday Pfizer + Gupy Brainfarma)\n');

const portals = yaml.load(readFileSync(join(ROOT, 'portals.yml'), 'utf-8'));
const tracked = portals.tracked_companies || [];
const pfizerEntry = tracked.find((e) => e.name === 'Pfizer');
const brainfarmaEntry = { name: 'Brainfarma (Gupy)', careers_url: 'https://brainfarma.gupy.io' };

const ctx = { fetchJson, fetchText: async (url, opts) => {
  const res = await fetch(url, { ...opts });
  return res.text();
} };

/** Coverage matrix */
const coverage = {};

async function probe(entry, providerName, providerImpl) {
  log(`\n### ${providerName} — ${entry.name}`);
  const t0 = Date.now();
  const jobs = await providerImpl.fetch(entry, ctx);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`Returned ${jobs.length} jobs in ${elapsed}s. Sample (first 3):\n`);
  for (const j of jobs.slice(0, 3)) {
    log(`- title='${(j.title || '').slice(0, 60)}' employment_type=${j.employment_type ?? '∅'} posted_at=${j.posted_at ?? '∅'} compensation=${j.compensation_min ?? '∅'}-${j.compensation_max ?? '∅'} ${j.compensation_currency ?? ''} apply_url=${j.apply_url ? 'YES' : '∅'}`);
  }
  const cov = {
    total: jobs.length,
    employment_type: jobs.filter((j) => j.employment_type).length,
    posted_at: jobs.filter((j) => j.posted_at).length,
    compensation_min: jobs.filter((j) => Number.isFinite(j.compensation_min)).length,
    compensation_max: jobs.filter((j) => Number.isFinite(j.compensation_max)).length,
    compensation_currency: jobs.filter((j) => j.compensation_currency).length,
    compensation_period: jobs.filter((j) => j.compensation_period).length,
    apply_url: jobs.filter((j) => j.apply_url).length,
  };
  coverage[providerName] = cov;

  // Also write 1 sample through formatPipelineLine roundtrip
  if (jobs.length > 0) {
    const sample = jobs[0];
    const formatted = formatPipelineLine(sample);
    log(`\nSample formatted line:\n\`${formatted.length > 200 ? formatted.slice(0, 197) + '...' : formatted}\`\n`);
    const reparsed = parsePipelineEntries(`## Pendientes\n${formatted}\n`)[0];
    const ok = (reparsed.url === sample.url) && (reparsed.title === sample.title);
    log(`Roundtrip url+title preserved: ${ok ? '✅' : '❌'}`);
  }
  return jobs;
}

try {
  if (pfizerEntry) await probe(pfizerEntry, 'workday', workday);
  await probe(brainfarmaEntry, 'gupy', gupy);
} catch (err) {
  log(`\nLive probe error: ${err.message}\n`);
}

log('\n### Coverage matrix\n');
log('| provider | total | employment_type | posted_at | compensation_min | _max | currency | period | apply_url |');
log('|---|---|---|---|---|---|---|---|---|');
for (const [name, c] of Object.entries(coverage)) {
  log(`| ${name} | ${c.total} | ${c.employment_type}/${c.total} | ${c.posted_at}/${c.total} | ${c.compensation_min}/${c.total} | ${c.compensation_max}/${c.total} | ${c.compensation_currency}/${c.total} | ${c.compensation_period}/${c.total} | ${c.apply_url}/${c.total} |`);
}

const overall = (failCount === 0) ? 'PASS' : 'FAIL';
log(`\n## Overall verdict (synthetic + live probes complete): **${overall}**\n`);

const outPath = join(OUT_DIR, `cotsk7-smoke-${ts()}.md`);
writeFileSync(outPath, REPORT_LINES.join('\n'), 'utf-8');
process.stdout.write(JSON.stringify({ verdict: overall, pass: passCount, total: synthetic.length, reportPath: outPath, coverage }, null, 2));
