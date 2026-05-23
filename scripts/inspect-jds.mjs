#!/usr/bin/env node
// @ts-check
/**
 * inspect-jds.mjs — thin CLI caller around classify-work-mode.mjs.
 *
 * Drives playwright headless to each URL, captures HTML + body innerText,
 * delegates classification to ../classify-work-mode.mjs, prints markdown
 * table sorted by tier ASC.
 *
 * USAGE:
 *   node scripts/inspect-jds.mjs <url1> [url2 ...]
 *   echo -e "url1\nurl2" | node scripts/inspect-jds.mjs --stdin
 *
 * NOTES:
 *   - Sequential (Phenom rate limit / Playwright concurrency).
 *   - waitUntil: 'domcontentloaded' (networkidle exceeded 30s on IQVIA).
 *   - Tier mapping + parse logic lives in classify-work-mode.mjs (shared).
 */

import { chromium } from 'playwright';
import { classifyFromHtml } from '../classify-work-mode.mjs';

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 */
export async function inspectOne(page, url) {
  /** @type {{url: string, location_real: string, work_mode: string, br_eligible: string, tier: number, evidence: string, error: string|null}} */
  const out = { url, location_real: '', work_mode: 'UNKNOWN', br_eligible: 'UNKNOWN', tier: 4, evidence: '', error: null };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500); // Phenom/Workday hydrate body innerText async; <2s is flaky for keywords like "Hybrid" embedded in the rendered card
    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const cls = classifyFromHtml(html, bodyText);
    out.work_mode = cls.work_mode;
    out.br_eligible = cls.br_eligible;
    out.tier = cls.tier;
    out.location_real = cls.location_real;
    out.evidence = cls.evidence;
  } catch (err) {
    out.error = /** @type {any} */ (err)?.message?.slice(0, 120) || String(err);
    out.evidence = `ERROR: ${out.error}`;
  }
  return out;
}

/**
 * Programmatic API — inspect N URLs sharing one browser. Exposed for migrate
 * scripts and provider enrichment so they don't spawn a subprocess per URL.
 *
 * @param {string[]} urls
 * @returns {Promise<Array<Awaited<ReturnType<typeof inspectOne>>>>}
 */
export async function inspectMany(urls) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 career-ops-inspect',
  });
  const page = await ctx.newPage();
  const results = [];
  let i = 0;
  for (const url of urls) {
    i++;
    process.stderr.write(`[${i}/${urls.length}] ${url.slice(0, 80)}...\n`);
    const r = await inspectOne(page, url);
    process.stderr.write(`  → tier=${r.tier} work_mode=${r.work_mode} br_eligible=${r.br_eligible}\n`);
    results.push(r);
  }
  await browser.close();
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let urls = [];
  if (args.includes('--stdin')) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    urls = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else {
    urls = args.filter((a) => /^https?:\/\//.test(a));
  }
  if (urls.length === 0) {
    console.error('Usage: node scripts/inspect-jds.mjs <url1> [url2 ...]');
    console.error('   or: node scripts/inspect-jds.mjs --stdin');
    process.exit(1);
  }

  const results = await inspectMany(urls);
  results.sort((a, b) => a.tier - b.tier);

  console.log('\n| tier | work_mode | br_eligible | location_real | url | evidence |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    const marker = r.tier === 1 ? '🎯 1' : String(r.tier);
    const ev = (r.evidence || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 200);
    const loc = (r.location_real || '').replace(/\|/g, '\\|').slice(0, 60);
    const url = r.url.length > 80 ? r.url.slice(0, 77) + '...' : r.url;
    console.log(`| ${marker} | ${r.work_mode} | ${r.br_eligible} | ${loc} | ${url} | ${ev} |`);
  }
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of results) counts[r.tier] = (counts[r.tier] || 0) + 1;
  console.log(`\nSummary: Tier1=${counts[1]} Tier2=${counts[2]} Tier3=${counts[3]} Tier4=${counts[4]}`);
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
  main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
}
