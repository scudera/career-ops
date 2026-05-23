#!/usr/bin/env node
// @ts-check
/**
 * dump-body-head.mjs — one-off CP3.5 Fase B verification.
 * Prints first 1200 chars of document.body.innerText after waitForStableDOM.
 * Used to investigate where "BRAZIL" comes from in the text-fallback path
 * when JSON-LD is absent (hypothesis 2: nav menu/footer false positive).
 */
import { chromium } from 'playwright';
import { waitForStableDOM } from '../classify-work-mode.mjs';

async function main() {
  const urls = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'career-ops-dump-body' });
  const page = await ctx.newPage();
  for (const url of urls) {
    process.stdout.write(`\n=== ${url} ===\n`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const wait = await waitForStableDOM(page);
      process.stdout.write(`waited=${wait.waitedMs}ms len=${wait.finalLen}\n`);
      const text = await page.evaluate(() => document.body?.innerText || '');
      process.stdout.write(`--- body[0..1200] ---\n${text.slice(0, 1200)}\n--- end ---\n`);
      // also flag where 'brazil' appears
      const re = /brazil|brasil/gi;
      let m;
      const hits = [];
      while ((m = re.exec(text)) !== null) hits.push({ idx: m.index, ctx: text.slice(Math.max(0, m.index - 30), m.index + 30) });
      process.stdout.write(`\nbrazil/brasil mentions: ${hits.length}\n`);
      for (const h of hits.slice(0, 10)) process.stdout.write(`  @${h.idx}: "...${h.ctx}..."\n`);
    } catch (err) {
      process.stdout.write(`ERROR: ${err.message}\n`);
    }
  }
  await browser.close();
}
main();
