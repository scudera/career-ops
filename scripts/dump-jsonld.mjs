#!/usr/bin/env node
// @ts-check
/**
 * dump-jsonld.mjs — extract raw JSON-LD JobPosting blocks from job URLs.
 *
 * One-off diagnostic tool created for CP3.5 Fase B (Phenom Brazil-quirk
 * verification). Hypothesis: Phenom-based career sites (jobs.iqvia.com,
 * careers.abbvie.com, etc.) embed `addressCountry: 'BRAZIL'` as a default
 * placeholder in JSON-LD, even when the actual job location is elsewhere
 * (Dublin, Reading, Maidenhead, Warsaw, etc.).
 *
 * Read-only. Dumps raw JSON-LD blocks (sanitized: title + description
 * truncated). Stays in the tree as a debug/audit utility.
 *
 * USAGE:
 *   node scripts/dump-jsonld.mjs <url1> [url2 ...]
 */

import { chromium } from 'playwright';
import { extractJsonLdBlocks, findJobPosting, waitForStableDOM } from '../classify-work-mode.mjs';

async function dumpOne(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const wait = await waitForStableDOM(page);
    process.stderr.write(`[dump-jsonld] waited=${wait.waitedMs}ms len=${wait.finalLen}${wait.stable ? '' : ' (TIMEOUT)'}\n`);
    const html = await page.content();
    const blocks = extractJsonLdBlocks(html);
    const jp = findJobPosting(blocks);
    return { url, blocks: blocks.length, jobPosting: jp };
  } catch (err) {
    return { url, error: /** @type {any} */ (err)?.message?.slice(0, 200) };
  }
}

function sanitize(jp) {
  if (!jp) return null;
  const out = { ...jp };
  if (typeof out.description === 'string') {
    out.description = `[truncated ${out.description.length} chars]`;
  }
  // Keep jobLocation structural intact — that's the whole point of the dump
  return out;
}

async function main() {
  const urls = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));
  if (urls.length === 0) {
    process.stderr.write('Usage: node scripts/dump-jsonld.mjs <url1> [url2 ...]\n');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 career-ops-dump',
  });
  const page = await ctx.newPage();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    process.stderr.write(`\n=== [${i + 1}/${urls.length}] ${url} ===\n`);
    const r = await dumpOne(page, url);
    if (r.error) {
      process.stdout.write(`ERROR: ${r.error}\n`);
      continue;
    }
    process.stdout.write(`URL: ${url}\n`);
    process.stdout.write(`JSON-LD blocks total: ${r.blocks}\n`);
    if (!r.jobPosting) {
      process.stdout.write(`JobPosting block: (none found)\n`);
      continue;
    }
    const sanitized = sanitize(r.jobPosting);
    process.stdout.write(`JobPosting (sanitized):\n${JSON.stringify(sanitized, null, 2)}\n`);
    process.stdout.write(`\njobLocation raw structural form:\n`);
    process.stdout.write(`  typeof: ${typeof r.jobPosting.jobLocation}\n`);
    process.stdout.write(`  isArray: ${Array.isArray(r.jobPosting.jobLocation)}\n`);
    process.stdout.write(`  value: ${JSON.stringify(r.jobPosting.jobLocation, null, 2)}\n`);
  }

  await browser.close();
}

main().catch((e) => { process.stderr.write(`Fatal: ${e.message}\n`); process.exit(1); });
