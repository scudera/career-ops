#!/usr/bin/env node

/**
 * validate-pipeline.mjs — HEAD-check all unchecked URLs in data/pipeline.md.
 *
 * Marks dead URLs (explicit 4xx/5xx) directly in pipeline.md.
 * Does NOT use Playwright — pure fetch for speed.
 * LinkedIn and other login-walled sites return 200 and are logged as "uncertain"
 * but NOT marked as [x] in pipeline.md.
 *
 * Usage:
 *   node validate-pipeline.mjs [--dry-run] [--only-new <snapshot-file>]
 *
 * Exit codes:
 *   0 = all active or uncertain (no dead URLs found)
 *   1 = one or more URLs were marked dead
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

const PIPELINE_PATH = resolve('./data/pipeline.md');
const CONCURRENCY = 8;

async function headCheck(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404 || res.status === 410) return { dead: true, reason: `HTTP ${res.status}` };
    if (res.status >= 400) return { dead: true, reason: `HTTP ${res.status}` };
    return { dead: false };
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return { dead: true, reason: 'timeout' };
    return { dead: true, reason: e.message.split('\n')[0] };
  }
}

/**
 * Worker-pool concurrency: 8 workers pulling from a shared queue index.
 * Avoids chunk-stall (slowest item per chunk) vs naive Promise.all chunking.
 */
async function parallelFetch(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // --only-new <file>: skip URLs already present in the snapshot file
  const onlyNewIdx = args.indexOf('--only-new');
  let skipUrls = null;
  if (onlyNewIdx !== -1 && args[onlyNewIdx + 1]) {
    const { readFileSync } = await import('fs');
    const snap = readFileSync(args[onlyNewIdx + 1], 'utf-8');
    skipUrls = new Set(snap.split('\n').map(u => u.trim()).filter(Boolean));
  }

  // Read pipeline.md
  let content;
  try {
    content = await readFile(PIPELINE_PATH, 'utf-8');
  } catch (e) {
    process.stderr.write(`Error: Could not read ${PIPELINE_PATH}\n${e.message}\n`);
    process.exit(1);
  }

  const lines = content.split('\n');

  // Extract unchecked items: lines matching `- [ ] https://...`
  // Only match [ ] (unchecked) — never touch [x] lines
  const pendingLineIndices = [];
  const pendingUrls = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^- \[ \] (https?:\/\/\S+)/);
    if (match) {
      if (skipUrls && skipUrls.has(match[1])) continue;
      pendingLineIndices.push(i);
      pendingUrls.push(match[1]);
    }
  }

  if (pendingUrls.length === 0) {
    process.stdout.write('No pending URLs to validate.\n');
    process.exit(0);
  }

  // Run HEAD checks in parallel (concurrency = 8)
  const checkResults = await parallelFetch(pendingUrls, (url) => headCheck(url), CONCURRENCY);

  // Tally results
  let deadCount = 0;
  let uncertainCount = 0;
  const deadEntries = []; // { url, reason, lineIdx }

  for (let i = 0; i < checkResults.length; i++) {
    const { dead, reason } = checkResults[i];
    if (dead) {
      deadCount++;
      deadEntries.push({ url: pendingUrls[i], reason, lineIdx: pendingLineIndices[i] });
    } else {
      // HEAD returned 2xx/3xx — not confirmed active, not confirmed dead
      uncertainCount++;
    }
  }

  const activeCount = 0; // HEAD can never confirm active
  const checkedCount = pendingUrls.length;

  // Build updated lines (only if not dry-run)
  let updatedLines = [...lines];
  if (deadEntries.length > 0) {
    for (const { lineIdx, reason } of deadEntries) {
      // Transform: `- [ ] https://url | ...` → `- [x] https://url | ... <!-- DEAD: <reason> -->`
      updatedLines[lineIdx] = updatedLines[lineIdx]
        .replace(/^- \[ \] /, '- [x] ')
        .trimEnd() + ` <!-- DEAD: ${reason} -->`;
    }
  }

  // Write updated file (only if not dry-run AND there are dead URLs)
  if (!dryRun && deadEntries.length > 0) {
    await writeFile(PIPELINE_PATH, updatedLines.join('\n'), 'utf-8');
  }

  // Print summary report
  const today = formatDate(new Date());
  const divider = '━'.repeat(33);

  process.stdout.write(`Pipeline Validation — ${today}\n`);
  process.stdout.write(`${divider}\n`);
  process.stdout.write(`URLs checked:    ${checkedCount}\n`);
  process.stdout.write(`Active:          ${activeCount}\n`);
  process.stdout.write(`Dead (marked):   ${dryRun ? deadCount + ' (dry-run — not written)' : deadCount}\n`);
  process.stdout.write(`Uncertain:       ${uncertainCount} (HEAD returned 2xx/3xx — not confirmed active, not confirmed dead)\n`);

  if (deadEntries.length > 0) {
    process.stdout.write(`\nDead URLs${dryRun ? ' (would be marked)' : ' marked'} in pipeline.md:\n`);
    for (const { url, reason } of deadEntries) {
      process.stdout.write(`  ✗ ${url} — ${reason}\n`);
    }
  }

  process.stdout.write(`\nRun /career-ops pipeline to evaluate the remaining active offers.\n`);

  process.exit(deadEntries.length > 0 ? 1 : 0);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
