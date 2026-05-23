#!/usr/bin/env node
// @ts-check
/**
 * cp5-gupy-probe.mjs — COTSK-6 Fase A diagnostic.
 *
 * Hipótese: APPLY_PATTERNS em liveness-core.mjs não cobre PT-BR
 * "Candidatar-me" / "Candidatar-se" (Gupy é portal BR).
 *
 * Probe: carrega Brainfarma SÊNIOR URL, capture
 * todos visible apply-button-like elements + their text,
 * confirma se "candidatar" presente.
 */

import { chromium } from 'playwright';
import { waitForStableDOM } from '../classify-work-mode.mjs';
import { writeFileSync } from 'node:fs';

const URL = 'https://brainfarma.gupy.io/job/eyJqb2JJZCI6MTEyMjQxNjAsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: 'cp5-gupy-probe/1.0' });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = await waitForStableDOM(page);
process.stderr.write(`waitForStableDOM: stable=${wait.stable} waited=${wait.waitedMs}ms len=${wait.finalLen}\n`);

// Mirror pre-apply-check.mjs visibility filter exactly
const controls = await page.evaluate(() => {
  const candidates = Array.from(
    document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
  );
  return candidates
    .filter((el) => {
      if (el.closest('nav, header, footer')) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (!el.getClientRects().length) return false;
      return Array.from(el.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    })
    .map((el) => {
      const label = [el.innerText, el.value, el.getAttribute('aria-label'), el.getAttribute('title')]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return { label, tag: el.tagName, role: el.getAttribute('role') || '' };
    })
    .filter((c) => c.label);
});

process.stdout.write(`# Visible interactive controls (${controls.length})\n\n`);
for (const c of controls) {
  process.stdout.write(`- [${c.tag}${c.role ? ` role=${c.role}` : ''}] "${c.label.slice(0, 120)}"\n`);
}

// Specifically look for candidatar / apply variants
process.stdout.write(`\n# Searching for apply-button candidates\n`);
const APPLY_RE = /\b(candidatar|candidat(ar)?-?se|candidatar-?me|apply|submit|easy apply|start application|solicitar|bewerben|postuler)\b/i;
const hits = controls.filter((c) => APPLY_RE.test(c.label));
process.stdout.write(`Apply-button candidates (expanded regex): ${hits.length}\n`);
for (const h of hits) {
  process.stdout.write(`- [${h.tag}] "${h.label.slice(0, 120)}"\n`);
}

// Also dump body title (sanity check page loaded)
const title = await page.evaluate(() => document.title);
process.stderr.write(`page.title="${title}"\n`);

const bodyExcerpt = await page.evaluate(() => document.body?.innerText?.slice(0, 600) || '');
writeFileSync('data/cp5-gupy-probe-body.txt', bodyExcerpt, 'utf8');
process.stderr.write(`body[0..600] saved to data/cp5-gupy-probe-body.txt\n`);

await browser.close();
