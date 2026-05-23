#!/usr/bin/env node
// @ts-check
/**
 * cotsk8-fase-c-validate.mjs — COTSK-8 Fase C re-validation.
 *
 * Re-validate the 3 CP4 ground-truth Gupy entries through the rewritten
 * provider (API primary + NEXT_DATA fallback). Expected:
 *   - Brainfarma → path=api,    1 regulat hit
 *   - Cristália  → path=next-data (API 0 hits), 1 regulat hit
 *   - MCassab    → path=api,    1 regulat hit
 *
 * Outputs Markdown comparison table to stderr + JSON to stdout for piping.
 */

import gupy from '../providers/gupy.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';

const ENTRIES = [
  {
    name: 'Brainfarma (Gupy)',
    careers_url: 'https://brainfarma.gupy.io',
    search_text: 'regulat',
    expected_path: 'api',
    expected_min_total: 50,
  },
  {
    name: 'Cristália (Gupy)',
    careers_url: 'https://cristalia.gupy.io',
    search_text: 'regulat',
    expected_path: 'next-data',
    expected_min_total: 20,
  },
  {
    name: 'MCassab Nutrição e Saúde Animal (Gupy)',
    careers_url: 'https://mcassabnutricaoesaudeanimal.gupy.io',
    search_text: 'regulat',
    expected_path: 'api',
    expected_min_total: 5,
  },
];

const ctx = makeHttpCtx();
const results = [];

for (const e of ENTRIES) {
  const t0 = Date.now();
  let jobs;
  let err = null;
  try {
    jobs = await gupy.fetch(e, ctx);
  } catch (ex) {
    err = String(ex?.message || ex);
    jobs = [];
  }
  const elapsedMs = Date.now() - t0;
  const sample = jobs[0] || null;
  results.push({
    entry: e.name,
    expected_path: e.expected_path,
    filtered_jobs: jobs.length,
    elapsed_ms: elapsedMs,
    sample_title: sample?.title || null,
    sample_posted_at: sample?.posted_at || null,
    sample_employment_type: sample?.employment_type || null,
    error: err,
  });
}

process.stderr.write('\n## Fase C Re-validation Results\n\n');
process.stderr.write('| entry | filtered jobs | sample posted_at | sample employment_type | elapsed |\n');
process.stderr.write('|-------|---------------|------------------|------------------------|---------|\n');
for (const r of results) {
  process.stderr.write(
    `| ${r.entry} | ${r.filtered_jobs} | ${r.sample_posted_at || '—'} | ${r.sample_employment_type || '—'} | ${r.elapsed_ms}ms |\n`
  );
}
process.stderr.write('\n');

console.log(JSON.stringify(results, null, 2));
