#!/usr/bin/env node

/**
 * pre-apply-check.mjs — Pre-flight liveness check before generating CV/cover letter/ATS answers.
 *
 * Called from the career-ops apply mode to verify a job posting is still active
 * before spending tokens on CV/cover letter generation.
 *
 * Usage:
 *   node pre-apply-check.mjs <url> [--job-num N]
 *
 * Output:
 *   stdout — JSON: { result, reason, job_num, url }
 *   stderr — Human-readable status line
 *
 * Exit codes:
 *   0 = active   (safe to proceed with application)
 *   1 = expired  (abort — job is dead)
 *   2 = uncertain (warn user, let them decide)
 */

import { chromium } from 'playwright';
import { classifyLiveness } from './liveness-core.mjs';
import { classifyFromHtml, waitForStableDOM } from './classify-work-mode.mjs';

async function checkUrl(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const status = response?.status() ?? 0;

    // Give SPAs (Ashby, Lever, Workday) time to hydrate — dynamic polling
    // (CP3 Phase A: substitutes the prior fixed 2000ms wait).
    const wait = await waitForStableDOM(page);
    if (!wait.stable) {
      process.stderr.write(`[pre-apply] dom-stable: waited=${wait.waitedMs}ms (TIMEOUT) — classification on partial DOM\n`);
    }

    const finalUrl = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const applyControls = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
      );

      return candidates
        .filter((element) => {
          if (element.closest('nav, header, footer')) return false;
          if (element.closest('[aria-hidden="true"]')) return false;

          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (!element.getClientRects().length) return false;

          return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
        })
        .map((element) => {
          const label = [
            element.innerText,
            element.value,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          return label;
        })
        .filter(Boolean);
    });

    const liveness = classifyLiveness({ status, finalUrl, bodyText, applyControls });

    // Always enrich when liveness is ACTIVE — page is already loaded, so the
    // classification is free. Caller (career-ops apply mode, manual review)
    // decides whether to surface the v2 fields. Old callers ignore `enriched`
    // (backward-compat: pure additive JSON key).
    if (liveness.result === 'active') {
      try {
        const html = await page.content();
        const cls = classifyFromHtml(html, bodyText);
        liveness.enriched = {
          work_mode: cls.work_mode,
          br_eligible: cls.br_eligible,
          tier: cls.tier,
          location_real: cls.location_real,
          evidence: cls.evidence,
        };
      } catch (err) {
        liveness.enriched = { error: err.message.split('\n')[0].slice(0, 120) };
      }
    }

    return liveness;

  } catch (err) {
    return { result: 'expired', reason: `navigation error: ${err.message.split('\n')[0]}` };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    process.stderr.write('Usage: node pre-apply-check.mjs <url> [--job-num N]\n');
    process.exit(1);
  }

  // Parse args: url is first non-flag arg, --job-num is optional
  let url = '';
  let jobNum = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--job-num' && args[i + 1]) {
      jobNum = args[++i];
    } else if (!args[i].startsWith('--')) {
      url = args[i];
    }
  }

  if (!url) {
    process.stderr.write('Usage: node pre-apply-check.mjs <url> [--job-num N]\n');
    process.exit(1);
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    process.stderr.write(`Error: URL must start with http:// or https://\nGot: ${url}\n`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  let result, reason, enriched;

  try {
    const page = await browser.newPage();
    ({ result, reason, enriched } = await checkUrl(page, url));
  } finally {
    await browser.close();
  }

  const output = { result, reason, job_num: jobNum, url };
  if (enriched) output.enriched = enriched;

  // Human-readable to stderr (stdout stays clean JSON)
  if (result === 'active') {
    process.stderr.write('✅ Vaga ativa — prosseguir com geração do pacote\n');
    if (enriched && !enriched.error) {
      process.stderr.write(`   work_mode=${enriched.work_mode} br_eligible=${enriched.br_eligible} tier=${enriched.tier} location_real="${enriched.location_real}"\n`);
    }
  } else if (result === 'expired') {
    process.stderr.write(`❌ Vaga expirada — abortar geração. Motivo: ${reason}\n`);
  } else {
    process.stderr.write(`⚠️  Status incerto — verificar manualmente antes de prosseguir. Motivo: ${reason}\n`);
  }

  // JSON to stdout for programmatic consumption
  process.stdout.write(JSON.stringify(output) + '\n');

  if (result === 'active') process.exit(0);
  if (result === 'expired') process.exit(1);
  process.exit(2);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
