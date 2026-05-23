#!/usr/bin/env node
// @ts-check
/**
 * test-jsonld-robustness.mjs — COTSK-9 (STEAL 6) test runner.
 *
 * Runs each case in fixtures/jsonld-edge-cases.json through the real
 * extractJsonLdBlocks → findJobPosting → parseJobPosting pipeline and
 * validates expected behavior. Exit 0 iff all cases pass.
 *
 * Case 7 deliberately exercises the WARN log path — stderr will show one
 * "[classify-work-mode] WARN" line during the run. That's expected.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractJsonLdBlocks,
  findJobPosting,
  parseJobPosting,
} from '../classify-work-mode.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jsonld-edge-cases.json'), 'utf-8'));

let pass = 0;
let fail = 0;
const failures = [];

for (const c of fixtures.cases) {
  const blocks = extractJsonLdBlocks(c.html);
  const jp = findJobPosting(blocks);

  if (c.expected.found === false) {
    if (jp === null) {
      pass++;
      console.log(`  PASS  ${c.name} — graceful null on unparseable payload`);
    } else {
      fail++;
      failures.push(`${c.name}: expected found=false, got JobPosting node`);
      console.log(`  FAIL  ${c.name} — expected null, got ${JSON.stringify(jp).slice(0, 80)}`);
    }
    continue;
  }

  if (!jp) {
    fail++;
    failures.push(`${c.name}: expected JobPosting, got null (blocks=${blocks.length})`);
    console.log(`  FAIL  ${c.name} — no JobPosting extracted (blocks=${blocks.length})`);
    continue;
  }

  const parsed = parseJobPosting(jp);
  const checks = [];
  if (c.expected.title !== undefined) {
    checks.push({ field: 'title', want: c.expected.title, got: jp.title });
  }
  if (c.expected.locationType !== undefined) {
    checks.push({ field: 'locationType', want: c.expected.locationType, got: parsed.locationType });
  }
  if (c.expected.employmentType !== undefined) {
    checks.push({ field: 'employmentType', want: c.expected.employmentType, got: parsed.employmentType });
  }

  const fieldFails = checks.filter((ch) => ch.got !== ch.want);
  if (fieldFails.length === 0) {
    pass++;
    console.log(`  PASS  ${c.name} — ${checks.map((ch) => `${ch.field}=${JSON.stringify(ch.got)}`).join(' ')}`);
  } else {
    fail++;
    const detail = fieldFails.map((ch) => `${ch.field}: want=${JSON.stringify(ch.want)} got=${JSON.stringify(ch.got)}`).join(' | ');
    failures.push(`${c.name}: ${detail}`);
    console.log(`  FAIL  ${c.name} — ${detail}`);
  }
}

console.log('');
console.log(`Results: ${pass} passed, ${fail} failed / ${fixtures.cases.length} cases`);

if (fail > 0) {
  console.log('');
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
