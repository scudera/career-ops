#!/usr/bin/env node
// @ts-check
/**
 * migrate-pipeline-schema.mjs — non-destructive migration v1 → v2.
 *
 * Reads data/pipeline.md (v1), re-classifies each `- [ ]` entry via
 * scripts/inspect-jds.mjs subprocess, and writes data/pipeline-v2.md with
 * the v2 metadata appended as a 4th pipe-delimited field:
 *
 *   - [ ] URL | Company | Title | T=N wm=WM br=BR loc=LOC
 *
 * Original pipeline.md is preserved untouched.
 *
 * USAGE:
 *   node scripts/migrate-pipeline-schema.mjs [--limit N] [--unchecked-only]
 *
 * FLAGS:
 *   --limit N         Cap to first N unchecked entries (default: all)
 *   --unchecked-only  Skip entries that are already checked (default: true)
 *
 * EXIT:
 *   0 success
 *   1 fatal error
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PIPELINE_IN = join(REPO_ROOT, 'data', 'pipeline.md');
const PIPELINE_OUT = join(REPO_ROOT, 'data', 'pipeline-v2.md');
const INSPECT_JDS = join(REPO_ROOT, 'scripts', 'inspect-jds.mjs');

const ENTRY_RE = /^- \[([ x])\] (.+)$/;
const URL_RE = /https?:\/\/[^\s|]+/;

/**
 * Parse a pipeline.md entry line into URL + remainder.
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
 * Spawn inspect-jds.mjs with N URLs via --stdin, parse markdown table back.
 * Returns Map<url, {tier, work_mode, br_eligible, location_real, evidence}>.
 *
 * @param {string[]} urls
 * @returns {Promise<Map<string, object>>}
 */
async function classifyUrls(urls) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSPECT_JDS, '--stdin'], {
      env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`inspect-jds exit ${code}`));
      resolve(parseInspectOutput(stdout));
    });
    child.stdin.write(urls.join('\n') + '\n');
    child.stdin.end();
  });
}

/**
 * Parse inspect-jds markdown table output back into per-URL records.
 * Table columns: tier | work_mode | br_eligible | location_real | url | evidence
 * URLs are truncated in display ("...") so we match URLs by prefix from input.
 *
 * @param {string} stdout
 * @returns {Map<string, object>}
 */
function parseInspectOutput(stdout) {
  const out = new Map();
  const lines = stdout.split(/\r?\n/);
  for (const ln of lines) {
    if (!ln.startsWith('| ')) continue;
    if (/^\|\s*tier\s*\|/i.test(ln)) continue;
    if (/^\|\s*-+\s*\|/.test(ln)) continue;
    // Parse cells (split by ' | ' avoids breaking on inner '|')
    const cells = ln.slice(1, -1).split(' | ').map((s) => s.trim());
    if (cells.length !== 6) continue; // strict — inspect-jds escapes inner | so 6 cells exact
    const [tierStr, work_mode, br_eligible, location_real, urlDisp, evidence] = cells;
    const tier = parseInt(tierStr.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(tier)) continue;
    // urlDisp may be truncated with '...' — match later by prefix
    out.set(urlDisp, { tier, work_mode, br_eligible, location_real, evidence, urlDisp });
  }
  return out;
}

/**
 * Resolve full URL by matching display prefix.
 * @param {string} fullUrl
 * @param {Map<string, object>} classified
 */
function resolveClassification(fullUrl, classified) {
  for (const [disp, rec] of classified.entries()) {
    const prefix = disp.replace(/\.\.\.$/, '');
    if (fullUrl.startsWith(prefix) || fullUrl === disp) return rec;
  }
  return null;
}

/**
 * Build the v2 metadata suffix: "T=N wm=WM br=BR loc=LOC".
 * @param {object} rec
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
  console.error(`Spawning inspect-jds.mjs for ${urls.length} URLs (sequential internally, ~15s each)...`);
  const classified = await classifyUrls(urls);
  console.error(`Got ${classified.size} classifications back.`);

  // Build output: rewrite only target lines with v2 suffix
  const outLines = inLines.slice();
  let classifiedCount = 0;
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const wmCounts = { REMOTE: 0, HYBRID: 0, ON_SITE: 0, UNKNOWN: 0 };

  for (const t of targets) {
    const rec = resolveClassification(t.url, classified);
    if (!rec) {
      console.error(`  ⚠️  no classification matched for ${t.url.slice(0, 80)}`);
      continue;
    }
    classifiedCount++;
    tierCounts[rec.tier] = (tierCounts[rec.tier] || 0) + 1;
    wmCounts[rec.work_mode] = (wmCounts[rec.work_mode] || 0) + 1;
    // Append v2 suffix to original line (preserve checkbox + existing pipes)
    const line = inLines[t.idx];
    // If line already has 4+ pipes (v2 already present), replace last field
    const pipeCount = (line.match(/\|/g) || []).length;
    const suffix = buildSuffix(rec);
    if (pipeCount >= 3) {
      // already has 3 pipes (URL|Company|Title) — append 4th
      outLines[t.idx] = `${line} | ${suffix}`;
    } else {
      outLines[t.idx] = `${line} | ${suffix}`;
    }
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
