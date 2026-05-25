#!/usr/bin/env node
// @ts-check
//
// sync-evals-to-notion.mjs — career-ops eval result sync.
//
// Reads reports/*.md, extracts URL (header) + score (Machine Summary YAML),
// and updates the Priority Score field on the matching Notion entry.
//
// DESIGN — Conservative (advisor-approved 2026-05-25):
//   - Writes ONLY the "Priority Score" property. Never touches Status, Notes,
//     or any other field. This preserves the invariant from
//     sync-pipeline-to-notion.mjs: "never overwrite Vitor's manual changes."
//   - Idempotent: re-running overwrites Priority Score with current report
//     value. Same value = no-op write (Notion accepts and ignores).
//   - Skips reports whose URL is not present in Notion (logs warning).
//
// Env vars (loaded via dotenv):
//   NOTION_TOKEN         (required) — internal integration secret.
//   NOTION_DATABASE_ID   (required) — Notion data_source_id of the target.
//   REPORTS_DIR          (optional) — default 'reports'.
//   DRY_RUN              (optional) — '1' to preview without writing.
//
// Notes:
//   - Rate limit: 80ms delay between updates (same as sync-pipeline).
//   - Exponential backoff on 429 (3 tries, 500/1000/2000 ms).
//
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Client } from '@notionhq/client';
import yaml from 'js-yaml';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';
const DRY_RUN = process.env.DRY_RUN === '1';

const UPDATE_DELAY_MS = 80;

if (!NOTION_TOKEN) {
  console.error('[evalsync] FATAL: NOTION_TOKEN env var is required');
  process.exit(1);
}
if (!NOTION_DATABASE_ID) {
  console.error('[evalsync] FATAL: NOTION_DATABASE_ID env var is required (data_source_id)');
  process.exit(1);
}
if (!existsSync(REPORTS_DIR)) {
  console.error(`[evalsync] FATAL: ${REPORTS_DIR} not found`);
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ─── Report parser ───────────────────────────────────────────────────
//
// Each report has:
//   **URL:** https://...          (in header block)
//   ## Machine Summary
//   ```yaml
//   score: 2.5
//   ...
//   ```
//
// We extract url + score. Everything else is ignored.

const URL_REGEX = /^\*\*URL:\*\*\s+(https?:\/\/\S+)/m;
const YAML_BLOCK_REGEX = /## Machine Summary\s*\n+```yaml\s*\n([\s\S]+?)\n```/;
// Header fallback for older reports (pre-2026-05) that pre-date Machine
// Summary: `**Score:** 2.8/5` or `**Score:** 2.8`. Tolerates whitespace.
const HEADER_SCORE_REGEX = /^\*\*Score:\*\*\s+(\d+(?:\.\d+)?)\s*(?:\/\s*5)?/m;

function parseReport(reportPath) {
  const text = readFileSync(reportPath, 'utf-8');

  const urlMatch = text.match(URL_REGEX);
  const url = urlMatch ? urlMatch[1].trim() : null;

  let score = null;

  // Preferred source: Machine Summary YAML block (newer reports).
  const yamlMatch = text.match(YAML_BLOCK_REGEX);
  if (yamlMatch) {
    try {
      const parsed = yaml.load(yamlMatch[1]);
      if (parsed && typeof parsed === 'object' && 'score' in parsed) {
        const raw = parsed.score;
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
        if (Number.isFinite(n)) score = n;
      }
    } catch (_err) {
      // YAML parse failed — fall through to header fallback.
    }
  }

  // Fallback: header `**Score:** X.X/5` line.
  if (score === null) {
    const headerMatch = text.match(HEADER_SCORE_REGEX);
    if (headerMatch) {
      const n = parseFloat(headerMatch[1]);
      if (Number.isFinite(n)) score = n;
    }
  }

  return { url, score };
}

// ─── Notion I/O with 429 retry ───────────────────────────────────────

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  const delays = [500, 1000, 2000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.code;
      const is429 = status === 429 || String(err?.message || '').includes('rate_limited');
      if (!is429 || attempt === delays.length) throw err;
      console.error(`[evalsync] ${label} hit 429 — retry ${attempt + 1}/${delays.length} in ${delays[attempt]}ms`);
      await sleep(delays[attempt]);
    }
  }
  throw lastErr;
}

async function findPageByUrl(url) {
  const res = await withRetry(
    () => notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      filter: { property: 'URL', url: { equals: url } },
      page_size: 1,
    }),
    'query',
  );
  return res.results[0] || null;
}

async function updatePriorityScore(pageId, score) {
  return withRetry(
    () => notion.pages.update({
      page_id: pageId,
      properties: {
        'Priority Score': { number: score },
      },
    }),
    'update',
  );
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.error(`[evalsync] Reading ${REPORTS_DIR}/…`);

  // Sort by report number ascending — predictable ordering.
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => /^\d+-.+\.md$/.test(f))
    .sort();

  console.error(`[evalsync] Found ${files.length} report files`);

  if (DRY_RUN) {
    console.error('[evalsync] DRY_RUN=1 — no Notion writes; preview only.\n');
  }

  let parsed = 0;
  let updated = 0;
  let noUrl = 0;
  let noScore = 0;
  let notInNotion = 0;
  let errors = 0;

  for (const file of files) {
    const reportPath = join(REPORTS_DIR, file);
    let entry;
    try {
      entry = parseReport(reportPath);
    } catch (err) {
      errors++;
      console.error(`[evalsync] ERR parse ${file}: ${err?.message || err}`);
      continue;
    }
    parsed++;

    if (!entry.url) {
      noUrl++;
      console.error(`[evalsync] skip ${file}: no **URL:** header`);
      continue;
    }
    if (entry.score === null) {
      noScore++;
      console.error(`[evalsync] skip ${file}: no score in Machine Summary`);
      continue;
    }

    try {
      const page = await findPageByUrl(entry.url);
      if (!page) {
        notInNotion++;
        console.error(`[evalsync] not-in-notion ${file}: ${entry.url}`);
        continue;
      }
      if (DRY_RUN) {
        updated++;
        console.error(`[evalsync] DRY would UPDATE ${file}: ${entry.url} → Priority Score = ${entry.score}`);
      } else {
        await updatePriorityScore(page.id, entry.score);
        updated++;
        console.error(`[evalsync] ✓ ${file}: ${entry.url} → ${entry.score}`);
        await sleep(UPDATE_DELAY_MS);
      }
    } catch (err) {
      errors++;
      console.error(`[evalsync] ERR ${file}: ${err?.message || err}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.error(`\n[evalsync] Parsed:        ${parsed} reports`);
  console.error(`[evalsync] Updated:       ${updated}${DRY_RUN ? ' (dry-run)' : ''}`);
  console.error(`[evalsync] No URL:        ${noUrl}`);
  console.error(`[evalsync] No score:      ${noScore}`);
  console.error(`[evalsync] Not in Notion: ${notInNotion}`);
  console.error(`[evalsync] Errors:        ${errors}`);
  console.error(`[evalsync] Done in ${elapsed}s`);

  if (errors > 0) process.exit(2);
}

main().catch((err) => {
  console.error('[evalsync] FATAL:', err?.message || err);
  process.exit(1);
});
