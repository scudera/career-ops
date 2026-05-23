#!/usr/bin/env node
// Quick probe — dump first Gupy job object to inspect real field names.
import { fetchJson } from '../providers/_http.mjs';

const origin = 'https://brainfarma.gupy.io';
const text = await (await fetch(origin)).text();
const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
if (!m) {
  process.stderr.write('NEXT_DATA not found\n');
  process.exit(1);
}
const data = JSON.parse(m[1]);
const jobs = data?.props?.pageProps?.jobs;
if (!Array.isArray(jobs) || jobs.length === 0) {
  process.stderr.write('no jobs in payload\n');
  process.exit(1);
}
const first = jobs[0];
process.stdout.write(`First job keys: ${Object.keys(first).join(', ')}\n\n`);
process.stdout.write(`Sample values:\n`);
for (const k of Object.keys(first)) {
  const v = first[k];
  const repr = (typeof v === 'object' && v !== null) ? JSON.stringify(v).slice(0, 120) : JSON.stringify(v);
  process.stdout.write(`  ${k} = ${repr}\n`);
}
