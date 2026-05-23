#!/usr/bin/env node
// @ts-check
/**
 * probe-workday.mjs — one-off diagnostic for COTSK-4.
 * POST limit=1 ao endpoint CXS, captura status, total, e shape do facets[].
 * Escreve dump JSON em data/cotsk4-{tenant}-probe.json
 *
 * USAGE:
 *   node scripts/probe-workday.mjs <tenant-url> [search]
 */

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const tenantUrl = args[0];
const search = args[1] || '';

if (!tenantUrl) {
  process.stderr.write('Usage: node scripts/probe-workday.mjs <tenant-url> [search]\n');
  process.exit(1);
}

const m = tenantUrl.match(/^https:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/?#]+)/);
if (!m) {
  process.stderr.write(`Not a Workday URL: ${tenantUrl}\n`);
  process.exit(1);
}
const [, tenant, shard, site] = m;
const endpoint = `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
process.stderr.write(`Probing ${endpoint}\n`);

const t0 = Date.now();
let res;
try {
  res = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'career-ops-probe/1.0' },
    body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: search }),
    redirect: 'error',
  });
} catch (err) {
  process.stderr.write(`FETCH FAIL: ${err?.message || err}\n`);
  process.exit(2);
}

const elapsed = Date.now() - t0;
process.stderr.write(`HTTP ${res.status} in ${elapsed}ms\n`);
if (!res.ok) {
  process.stderr.write(`FAILED. Body: ${(await res.text()).slice(0, 500)}\n`);
  process.exit(3);
}

const data = await res.json();
const total = data?.total;
const postings = Array.isArray(data?.jobPostings) ? data.jobPostings.length : 0;
const facets = Array.isArray(data?.facets) ? data.facets : [];

process.stderr.write(`total=${total} postings.length=${postings} facets.length=${facets.length}\n`);
for (const f of facets) {
  const valCount = Array.isArray(f.values) ? f.values.length : 0;
  const first3 = Array.isArray(f.values) ? f.values.slice(0, 3).map((v) => `${v.descriptor}(${v.count})`).join(' | ') : '';
  process.stderr.write(`  ${f.facetParameter}: ${valCount} values; first 3: ${first3}\n`);
}

const outPath = `data/cotsk4-${tenant}-probe.json`;
writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
process.stderr.write(`Dumped to ${outPath}\n`);
