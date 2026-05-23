#!/usr/bin/env node
// @ts-check
/**
 * cotsk8-fase-d-smoke.mjs — COTSK-8 Fase D coverage delta.
 *
 * Run all enabled Gupy tenants from portals.yml through the rewritten
 * provider. Capture per-tenant: path used, items fetched, v2.1 field
 * coverage (employment_type %, posted_at %). Report a coverage delta:
 *   BEFORE (NEXT_DATA only): posted_at coverage = 0%
 *   AFTER  (API + fallback): posted_at coverage = X%
 */

import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import gupy from '../providers/gupy.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';

const portalsYaml = readFileSync('portals.yml', 'utf-8');
const cfg = yaml.load(portalsYaml);

/** @type {Array<any>} */
const gupyEntries = (cfg.tracked_companies || []).filter(
  (c) => c?.provider === 'gupy' && c?.enabled !== false
);

process.stderr.write(`\n## Fase D Coverage Smoke — ${gupyEntries.length} enabled Gupy tenants\n\n`);

const ctx = makeHttpCtx();
const perTenant = [];

for (const e of gupyEntries) {
  const t0 = Date.now();
  // Disable search_text filter for coverage purposes — we want the whole
  // population to measure raw v2.1 field coverage, not filtered subset.
  const probeEntry = { ...e, search_text: '' };
  let jobs = [];
  let err = null;
  try {
    jobs = await gupy.fetch(probeEntry, ctx);
  } catch (ex) {
    err = String(ex?.message || ex);
  }
  const elapsedMs = Date.now() - t0;
  const total = jobs.length;
  const withEt = jobs.filter((j) => !!j.employment_type).length;
  const withPosted = jobs.filter((j) => !!j.posted_at).length;
  perTenant.push({
    name: e.name,
    total,
    et_count: withEt,
    et_pct: total ? Math.round((withEt / total) * 100) : 0,
    posted_count: withPosted,
    posted_pct: total ? Math.round((withPosted / total) * 100) : 0,
    elapsed_ms: elapsedMs,
    error: err,
  });
}

process.stderr.write('| tenant | total | employment_type | posted_at | elapsed |\n');
process.stderr.write('|--------|-------|-----------------|-----------|---------|\n');
let grandTotal = 0;
let grandEt = 0;
let grandPosted = 0;
let apiCount = 0;
let nextDataCount = 0;
for (const r of perTenant) {
  grandTotal += r.total;
  grandEt += r.et_count;
  grandPosted += r.posted_count;
  // posted_at > 0 ⇒ API path was used for this tenant
  if (r.posted_count > 0) apiCount++;
  else nextDataCount++;
  const errSuffix = r.error ? ` ⚠ ${r.error.slice(0, 40)}` : '';
  process.stderr.write(
    `| ${r.name} | ${r.total} | ${r.et_count}/${r.total} (${r.et_pct}%) | ${r.posted_count}/${r.total} (${r.posted_pct}%) | ${r.elapsed_ms}ms${errSuffix} |\n`
  );
}

const etPct = grandTotal ? Math.round((grandEt / grandTotal) * 100) : 0;
const postedPct = grandTotal ? Math.round((grandPosted / grandTotal) * 100) : 0;

process.stderr.write(`\n### Aggregate\n\n`);
process.stderr.write(`- Tenants on API path:       ${apiCount}/${perTenant.length}\n`);
process.stderr.write(`- Tenants on NEXT_DATA path: ${nextDataCount}/${perTenant.length}\n`);
process.stderr.write(`- Total jobs:                ${grandTotal}\n`);
process.stderr.write(`- employment_type coverage:  ${grandEt}/${grandTotal} (${etPct}%)\n`);
process.stderr.write(`- posted_at coverage:        ${grandPosted}/${grandTotal} (${postedPct}%) — BEFORE was 0%\n`);
process.stderr.write(`\n### Delta vs BEFORE (NEXT_DATA only)\n\n`);
process.stderr.write(`- posted_at:        0% → ${postedPct}%  (+${postedPct}pp)\n`);
process.stderr.write(`- employment_type:  unchanged (both paths populate)\n`);

console.log(JSON.stringify({
  per_tenant: perTenant,
  aggregate: {
    tenants_api: apiCount,
    tenants_next_data: nextDataCount,
    total_jobs: grandTotal,
    et_count: grandEt,
    et_pct: etPct,
    posted_count: grandPosted,
    posted_pct: postedPct,
  },
}, null, 2));
