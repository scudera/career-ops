#!/usr/bin/env node
// @ts-check
/**
 * seed-workday-slugs — verify Workday tenant/site combinations from registry.
 *
 * Usage:
 *   node scripts/seed-workday-slugs.mjs <company1> [company2] ...
 *
 * Adapted from LeoLaborie/claude-apply (MIT) scripts/seed-workday-slugs.mjs
 * — REPLACED Playwright network-capture with verifySlug HTTP (sync ~2s vs ~3min).
 *
 * For each company name argument:
 *   1. Look up in WORKDAY_REGISTRY (providers/workday-slugs.mjs)
 *   2. If found, call verifySlug() to confirm the slug still works
 *   3. Report PASS/FAIL with details
 *
 * Companies not in registry yield a "no entry" error.
 * To add a new company: edit providers/workday-slugs.mjs after manual discovery.
 */

import { verifySlug } from '../providers/workday.mjs';
import { WORKDAY_REGISTRY, normalizeKey, toCareersUrl, lookupCompany } from '../providers/workday-slugs.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/seed-workday-slugs.mjs <company1> [company2] ...');
    console.error('');
    console.error(`Known companies (${Object.keys(WORKDAY_REGISTRY).length} in registry):`);
    for (const k of Object.keys(WORKDAY_REGISTRY).sort()) {
      const e = WORKDAY_REGISTRY[k];
      console.error(`  - ${k}: ${e.tenant}.${e.shard}/${e.site}`);
    }
    process.exit(2);
  }

  let pass = 0;
  let fail = 0;
  for (const companyArg of args) {
    const entry = lookupCompany(companyArg);
    if (!entry) {
      console.log(`FAIL ${companyArg} — no entry in WORKDAY_REGISTRY (normalize key: ${normalizeKey(companyArg)})`);
      fail++;
      continue;
    }
    const url = toCareersUrl(entry);
    process.stdout.write(`... ${companyArg} → ${url} ... `);
    const result = await verifySlug(url);
    if (result.ok) {
      console.log(`OK (count=${result.count})`);
      pass++;
    } else {
      const status = result.status ? `HTTP ${result.status}` : '';
      console.log(`FAIL ${status} ${result.reason || ''}`);
      fail++;
    }
  }

  console.log('');
  console.log(`Result: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
