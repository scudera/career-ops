#!/usr/bin/env node
// @ts-check
/**
 * cotsk8-gupy-api-probe.mjs — COTSK-8 Fase A diagnostic.
 *
 * Probe employability-portal.gupy.io/api/v1/jobs:
 *   - Captura HTTP status + response shape
 *   - Lista TODOS os fields disponíveis em data[]
 *   - Pega sample real (3-5 jobs) com todos campos
 *   - Testa filter parameters disponíveis
 *
 * Outputs: data/cotsk8-gupy-api-probe.json + stderr summary
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function probe(url, label) {
  process.stderr.write(`\n=== ${label} ===\n${url}\n`);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'career-ops-probe/1.0' } });
    const elapsed = Date.now() - t0;
    process.stderr.write(`HTTP ${res.status} in ${elapsed}ms\n`);
    if (!res.ok) {
      process.stderr.write(`FAIL: ${(await res.text()).slice(0, 300)}\n`);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    process.stderr.write(`FETCH FAIL: ${err?.message || err}\n`);
    return null;
  }
}

// 1) Basic probe: keyword search regulatory
const r1 = await probe(
  'https://employability-portal.gupy.io/api/v1/jobs?jobName=regulatory&limit=5',
  'Basic search jobName=regulatory limit=5'
);

if (r1) {
  process.stderr.write(`\nTop-level keys: ${Object.keys(r1).join(', ')}\n`);
  const list = Array.isArray(r1.data) ? r1.data : (Array.isArray(r1) ? r1 : []);
  process.stderr.write(`Items: ${list.length}\n`);
  if (list.length > 0) {
    const first = list[0];
    process.stderr.write(`First item keys (${Object.keys(first).length}): ${Object.keys(first).join(', ')}\n`);
    process.stderr.write(`\nSample values (first item):\n`);
    for (const k of Object.keys(first)) {
      const v = first[k];
      const repr = (typeof v === 'object' && v !== null) ? JSON.stringify(v).slice(0, 150) : JSON.stringify(v);
      process.stderr.write(`  ${k} = ${repr}\n`);
    }
  }
  writeFileSync(join(ROOT, 'data', 'cotsk8-gupy-api-probe.json'), JSON.stringify(r1, null, 2), 'utf-8');
}

// 2) Filter probe: workplaceTypes
const r2 = await probe(
  'https://employability-portal.gupy.io/api/v1/jobs?jobName=regulatory&workplaceTypes[]=remote&limit=3',
  'Filter workplaceTypes[]=remote'
);
if (r2) {
  const list = Array.isArray(r2.data) ? r2.data : (Array.isArray(r2) ? r2 : []);
  process.stderr.write(`Remote-only items: ${list.length}\n`);
  if (list.length > 0) {
    process.stderr.write(`First sample workplaceType=${JSON.stringify(list[0].workplaceType)}\n`);
  }
}

// 3) BR pharma keyword (assuntos regulatórios)
const r3 = await probe(
  'https://employability-portal.gupy.io/api/v1/jobs?jobName=assuntos%20regulat%C3%B3rios&limit=5',
  'BR PT search assuntos regulatórios'
);
if (r3) {
  const list = Array.isArray(r3.data) ? r3.data : (Array.isArray(r3) ? r3 : []);
  process.stderr.write(`BR PT items: ${list.length}\n`);
}
