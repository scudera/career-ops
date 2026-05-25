#!/usr/bin/env node
// @ts-check
//
// sync-pipeline-to-notion.mjs — career-ops daily cron sync.
//
// Reads data/pipeline.md line-by-line, parses each v2.1 job entry, and
// upserts into the Notion Vagas Tracker by URL (dedup key).
//
//   - INSERT  : new URL → page created with Status="Identified".
//   - SKIP    : URL already present → never overwrite (preserves Vitor's
//               manual Status changes downstream).
//
// Env vars (loaded via dotenv):
//   NOTION_TOKEN         (required) — internal integration secret.
//   NOTION_DATABASE_ID   (required) — Notion data_source_id of the target.
//   PIPELINE_PATH        (optional) — default 'data/pipeline.md'.
//   DRY_RUN              (optional) — '1' to preview without writing.
//
// Notes:
//   - Sequential inserts with 80ms delay → stays under Notion's 3 req/s soft
//     limit. Exponential backoff on 429 (3 tries, 500/1000/2000 ms).
//   - URL is the dedup primary key. Multiple Notion pages with the same URL
//     are treated as "exists" and skipped (no de-duping work here).
//   - Schema v2.1 fields that are missing leave the Notion property unset.

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const PIPELINE_PATH = process.env.PIPELINE_PATH || 'data/pipeline.md';
const DRY_RUN = process.env.DRY_RUN === '1';

const INSERT_DELAY_MS = 80;
// SDK v4.0.2's typed `databases.query` / `pages.create` send requests to the
// `/v1/databases/{id}/...` paths. The 2025-09-03 Notion API moved query/insert
// for multi-source DBs to `/v1/data_sources/{id}/...` — which the SDK's typed
// helpers do not emit. Override to 2025-09-03 returns `invalid_request_url`
// for every call. Sticking to the SDK default (2022-06-28) keeps the typed
// methods on the old path, which is still supported and works against either
// the database_id or (for single-source DBs) the data_source_id.
const NOTION_API_VERSION = undefined;

if (!NOTION_TOKEN) {
  console.error('[sync] FATAL: NOTION_TOKEN env var is required');
  process.exit(1);
}
if (!NOTION_DATABASE_ID) {
  console.error('[sync] FATAL: NOTION_DATABASE_ID env var is required (data_source_id)');
  process.exit(1);
}
if (!existsSync(PIPELINE_PATH)) {
  console.error(`[sync] FATAL: ${PIPELINE_PATH} not found`);
  process.exit(1);
}

const notion = new Client(
  NOTION_API_VERSION
    ? { auth: NOTION_TOKEN, notionVersion: NOTION_API_VERSION }
    : { auth: NOTION_TOKEN },
);

// ─── Pipeline line parser ─────────────────────────────────────────────
//
// scan.mjs::formatPipelineLine emits:
//   - [ ] {url} | {company} | {title} | {v2.0 tokens} | {v2.1 tokens}
//
// v2.0 tokens (space-separated): T={1..4} wm={MODE} br={BR} loc={text}
// v2.1 tokens (space-separated): et={TYPE} cmin={n} cmax={n} ccy={CCY}
//                                cper={PER} posted={YYYY-MM-DD} apply={url}
//
// If v2.0 is empty but v2.1 is present, scan.mjs pads with empty pipe-3 so
// parts[3] is empty string and parts[4] holds v2.1. Trailing HTML comments
// like `<!-- DEAD: HTTP 410 -->` are stripped before parsing.

const LINE_REGEX = /^- \[[ x]\]\s+(.+)$/;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->\s*$/;

// Parse a token block like "T=1 wm=REMOTE br=BR_OK loc=Remote BR" where
// continuation words (no `=`) belong to the previous key's value. This
// preserves multi-word `loc=...` values that scan.mjs::formatPipelineLine
// emits verbatim.
function parseTokenBlock(block) {
  const out = {};
  let currentKey = null;
  let currentVal = [];
  for (const tok of block.split(/\s+/)) {
    if (!tok) continue;
    const eqIdx = tok.indexOf('=');
    if (eqIdx > 0) {
      if (currentKey) out[currentKey] = currentVal.join(' ');
      currentKey = tok.slice(0, eqIdx);
      currentVal = [tok.slice(eqIdx + 1)];
    } else if (currentKey) {
      currentVal.push(tok);
    }
  }
  if (currentKey) out[currentKey] = currentVal.join(' ');
  return out;
}

function parsePipelineLine(rawLine) {
  const m = rawLine.match(LINE_REGEX);
  if (!m) return null;
  const body = m[1].replace(HTML_COMMENT_REGEX, '').trim();
  if (!body) return null;

  // Use lenient pipe split so that the `... | | et=...` placeholder (emitted
  // by formatPipelineLine when v2.0 block is empty but v2.1 is present)
  // yields an empty middle part. URLs never contain literal `|`.
  const parts = body.split(/\s*\|\s*/);
  if (parts.length < 3) return null;
  const [url, company, title, v2Block, v21Block] = parts;
  if (!url || !company || !title) return null;
  if (!/^https?:\/\//.test(url)) return null;

  const job = { url: url.trim(), company: company.trim(), title: title.trim() };

  const v2 = v2Block ? parseTokenBlock(v2Block) : {};
  const v21 = v21Block ? parseTokenBlock(v21Block) : {};

  if (v2.T) job.tier = parseInt(v2.T, 10);
  if (v2.wm) job.work_mode = v2.wm;
  if (v2.br) job.br_eligible = v2.br;
  if (v2.loc) job.location_real = v2.loc;

  if (v21.et) job.employment_type = v21.et;
  if (v21.cmin) job.compensation_min = Number(v21.cmin);
  if (v21.cmax) job.compensation_max = Number(v21.cmax);
  if (v21.ccy) job.compensation_currency = v21.ccy;
  if (v21.cper) job.compensation_period = v21.cper;
  if (v21.posted) job.posted_at = v21.posted;
  if (v21.apply) job.apply_url = v21.apply;

  return job;
}

// ─── Provider URL heuristic ──────────────────────────────────────────

// Notion "Provider" select option set (source of truth):
//   workday, gupy, workable, phenom, smartrec, linkedin-manual, referral, other
//
// greenhouse/lever/ashby/etc are NOT in the DB select today — they fall
// through to "other" rather than risking a `validation_error` on insert.
// If those providers gain dedicated tenants later, add the options to the
// DB schema first, then extend this mapping.
function deriveProvider(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/\.myworkdayjobs\.com$/.test(host)) return 'workday';
    if (host.endsWith('.gupy.io')) return 'gupy';
    if (host.endsWith('.workable.com')) return 'workable';
    if (host.endsWith('.smartrecruiters.com')) return 'smartrec';
    if (host === 'jobs.thermofisher.com' || host === 'jobs.merck.com' || host.endsWith('.phenompeople.com')) return 'phenom';
    if (host === 'www.linkedin.com' || host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin-manual';
  } catch (_err) {
    return 'other';
  }
  return 'other';
}

// ─── Notion property builder ─────────────────────────────────────────

const VALID_TIERS = new Set([1, 2, 3, 4]);
const VALID_WORK_MODES = new Set(['REMOTE', 'HYBRID', 'ON_SITE', 'UNKNOWN']);
const VALID_BR_ELIGIBLE = new Set(['BR_OK', 'RELOCATION_REQUIRED', 'UNKNOWN']);
const VALID_EMP_TYPES = new Set(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY', 'UNKNOWN']);

function buildNotes(job) {
  const parts = [];
  if (job.apply_url) parts.push(`Apply: ${job.apply_url}`);
  if (Number.isFinite(job.compensation_min) || Number.isFinite(job.compensation_max)) {
    const min = Number.isFinite(job.compensation_min) ? job.compensation_min : '?';
    const max = Number.isFinite(job.compensation_max) ? job.compensation_max : '?';
    const ccy = job.compensation_currency || '';
    const per = job.compensation_period && job.compensation_period !== 'UNKNOWN' ? `/${job.compensation_period}` : '';
    parts.push(`Salary: ${min}-${max} ${ccy}${per}`.trim());
  }
  return parts.join(' | ');
}

function buildProperties(job, today) {
  const props = {
    'Job Title': { title: [{ text: { content: job.title.slice(0, 2000) } }] },
    'Company': { rich_text: [{ text: { content: job.company.slice(0, 2000) } }] },
    'URL': { url: job.url },
    'Provider': { select: { name: deriveProvider(job.url) } },
    'Status': { select: { name: 'Identified' } },
    'Discovery Date': { date: { start: today } },
  };

  if (VALID_TIERS.has(job.tier)) {
    props['Tier'] = { select: { name: `T${job.tier}` } };
  }
  if (VALID_WORK_MODES.has(job.work_mode)) {
    props['Work Mode'] = { select: { name: job.work_mode } };
  }
  if (VALID_BR_ELIGIBLE.has(job.br_eligible)) {
    props['BR Eligible'] = { select: { name: job.br_eligible } };
  }
  const loc = (job.location_real || job.location || '').trim();
  if (loc) {
    props['Location'] = { rich_text: [{ text: { content: loc.slice(0, 2000) } }] };
  }
  if (VALID_EMP_TYPES.has(job.employment_type)) {
    props['Employment Type'] = { select: { name: job.employment_type } };
  }
  if (job.posted_at && /^\d{4}-\d{2}-\d{2}$/.test(job.posted_at)) {
    props['Posted At'] = { date: { start: job.posted_at } };
  }
  const notes = buildNotes(job);
  if (notes) {
    props['Notes'] = { rich_text: [{ text: { content: notes.slice(0, 2000) } }] };
  }
  return props;
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
      console.error(`[sync] ${label} hit 429 — retry ${attempt + 1}/${delays.length} in ${delays[attempt]}ms`);
      await sleep(delays[attempt]);
    }
  }
  throw lastErr;
}

async function urlExistsInNotion(url) {
  const res = await withRetry(
    () => notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      filter: { property: 'URL', url: { equals: url } },
      page_size: 1,
    }),
    'query',
  );
  return res.results.length > 0;
}

async function insertJob(job, today) {
  return withRetry(
    () => notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: buildProperties(job, today),
    }),
    'insert',
  );
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  console.error(`[sync] Reading ${PIPELINE_PATH}…`);

  const text = readFileSync(PIPELINE_PATH, 'utf-8');
  const lines = text.split(/\r?\n/);
  const jobs = [];
  for (const line of lines) {
    const job = parsePipelineLine(line);
    if (job) jobs.push(job);
  }
  console.error(`[sync] Parsed: ${jobs.length} jobs from ${PIPELINE_PATH}`);

  if (DRY_RUN) {
    console.error('[sync] DRY_RUN=1 — no Notion writes; preview only.\n');
  }

  let queried = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of jobs) {
    try {
      const exists = await urlExistsInNotion(job.url);
      queried++;
      if (exists) {
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        inserted++; // count what we would have done
        console.error(`[sync] DRY would INSERT: ${job.url} (${job.company} — ${job.title.slice(0, 60)})`);
      } else {
        await insertJob(job, today);
        inserted++;
        await sleep(INSERT_DELAY_MS);
      }
    } catch (err) {
      errors++;
      console.error(`[sync] ERR ${job.url}: ${err?.message || err}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.error(`\n[sync] Parsed:   ${jobs.length} jobs from ${PIPELINE_PATH}`);
  console.error(`[sync] Queried:  ${queried} (Notion lookups)`);
  console.error(`[sync] Inserted: ${inserted} (new${DRY_RUN ? ', dry-run' : ''})`);
  console.error(`[sync] Skipped:  ${skipped} (URL already present)`);
  console.error(`[sync] Errors:   ${errors}`);
  console.error(`[sync] Done in ${elapsed}s`);

  if (errors > 0) process.exit(2);
}

main().catch((err) => {
  console.error('[sync] FATAL:', err?.message || err);
  process.exit(1);
});
