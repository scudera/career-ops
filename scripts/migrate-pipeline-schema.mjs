#!/usr/bin/env node
// @ts-check
/**
 * migrate-pipeline-schema.mjs — non-destructive migration v1 → v2.
 *
 * Reads data/pipeline.md (v1), re-classifies each `- [ ]` entry via the
 * shared classify-work-mode + playwright inspect pipeline, writes
 * data/pipeline-v2.md with the v2 metadata appended as a 4th pipe-delimited
 * field:
 *
 *   - [ ] URL | Company | Title | T=N wm=WM br=BR loc=LOC
 *
 * Original pipeline.md is preserved untouched.
 *
 * CP2 update: switched from subprocess invocation of inspect-jds.mjs to
 * direct import (`inspectMany` from ../scripts/inspect-jds.mjs), reusing
 * one browser context across all URLs. Faster + cleaner error handling.
 *
 * USAGE:
 *   node scripts/migrate-pipeline-schema.mjs [--limit N] [--all-states]
 *
 * FLAGS:
 *   --limit=N      Cap to first N unchecked entries (default: all)
 *   --all-states   Include already-checked entries (default: unchecked only)
 *
 * EXIT:
 *   0 success
 *   1 fatal error
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMany } from './inspect-jds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PIPELINE_IN = join(REPO_ROOT, 'data', 'pipeline.md');
const PIPELINE_OUT = join(REPO_ROOT, 'data', 'pipeline-v2.md');

const ENTRY_RE = /^- \[([ x])\] (.+)$/;
const URL_RE = /https?:\/\/[^\s|]+/;

/**
 * @param {string} line
 */
function parseEntry(line) {
  const m = line.match(ENTRY_RE);
  if (!m) return null;
  const checked = m[1] === 'x';
  const rest = m[2];
  const urlMatch = rest.match(URL_RE);
  if (!urlMatch) return null;
  return { checked, rest, url: urlMatch[0] };
}

/**
 * @param {{tier: number, work_mode: string, br_eligible: string, location_real: string}} rec
 */
function buildSuffix(rec) {
  const loc = (rec.location_real || '').replace(/\|/g, '/').slice(0, 120);
  return `T=${rec.tier} wm=${rec.work_mode} br=${rec.br_eligible} loc=${loc}`;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='))?.slice(8);
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
  const uncheckedOnly = !args.includes('--all-states');

  const raw = readFileSync(PIPELINE_IN, 'utf8');
  const inLines = raw.split(/\r?\n/);

  const candidates = [];
  for (let i = 0; i < inLines.length; i++) {
    const parsed = parseEntry(inLines[i]);
    if (!parsed) continue;
    if (uncheckedOnly && parsed.checked) continue;
    candidates.push({ idx: i, ...parsed });
  }
  const targets = candidates.slice(0, limit);
  console.error(`pipeline.md: ${inLines.length} lines, ${candidates.length} unchecked entries, classifying ${targets.length}`);

  if (targets.length === 0) {
    console.error('Nothing to classify. Exit 0.');
    process.exit(0);
  }

  const urls = targets.map((t) => t.url);
  const results = await inspectMany(urls);

  // Map URL → result. inspectMany preserves order, so we can zip.
  const byUrl = new Map();
  for (let i = 0; i < urls.length; i++) byUrl.set(urls[i], results[i]);

  const outLines = inLines.slice();
  let classifiedCount = 0;
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const wmCounts = { REMOTE: 0, HYBRID: 0, ON_SITE: 0, UNKNOWN: 0 };

  for (const t of targets) {
    const rec = byUrl.get(t.url);
    if (!rec || rec.error) {
      console.error(`  ⚠️  classification failed for ${t.url.slice(0, 80)}: ${rec?.error || 'no result'}`);
      continue;
    }
    classifiedCount++;
    tierCounts[/** @type {1|2|3|4} */ (rec.tier)] = (tierCounts[rec.tier] || 0) + 1;
    wmCounts[/** @type {keyof typeof wmCounts} */ (rec.work_mode)] = (wmCounts[rec.work_mode] || 0) + 1;
    outLines[t.idx] = `${inLines[t.idx]} | ${buildSuffix(rec)}`;
  }

  writeFileSync(PIPELINE_OUT, outLines.join('\n'), 'utf8');
  console.error(`\nWrote ${PIPELINE_OUT}`);
  console.error(`\n=== Migration report ===`);
  console.error(`Total unchecked entries:     ${candidates.length}`);
  console.error(`Targeted (post --limit):     ${targets.length}`);
  console.error(`Classified successfully:     ${classifiedCount}`);
  console.error(`Unmatched (kept as v1):      ${targets.length - classifiedCount}`);
  console.error(`Tier distribution:           T1=${tierCounts[1]} T2=${tierCounts[2]} T3=${tierCounts[3]} T4=${tierCounts[4]}`);
  console.error(`work_mode distribution:      REMOTE=${wmCounts.REMOTE} HYBRID=${wmCounts.HYBRID} ON_SITE=${wmCounts.ON_SITE} UNKNOWN=${wmCounts.UNKNOWN}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
