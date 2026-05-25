#!/usr/bin/env node
// @ts-check
/**
 * cp4-fase-a-workday-scan.mjs — COTSK-5 Fase A: parcial Workday scan.
 *
 * Loads portals.yml → filtra entries Workday-resolvidas via workday.detect()
 * (skips entries com scan_method != undefined && != 'workday' — mirror
 * scan.mjs resolver). Para cada tenant:
 *   1. Probe limit=1 → captura total + budget de tempo
 *   2. Se total < 2000 OU budget OK → workday.fetch full (com subdivision)
 *   3. Else: paginate-with-cap fallback diagnostic
 *
 * Diff:
 *   - Lê pipeline.md, extrai todos URLs (checked + unchecked) → set de req_id
 *   - jobs[] from scan: NEW if req_id NOT in pipeline req_id set
 *
 * Filtro RA-relevant (regex case-insensitive em title):
 *   /regulatory|reg\s*affairs|assuntos\s*regulat[oó]rio/i
 *
 * Output:
 *   - data/cp4-fase-a-workday-discovery-{ts}.md (Vitor lê e valida)
 *   - NÃO escreve em pipeline.md
 *
 * ABORT condition: tenant individual > BUDGET_PER_TENANT_MS → skip + log.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import workday from '../providers/workday.mjs';
import { fetchJson } from '../providers/_http.mjs';
import { parsePipelineEntries } from '../filter-candidates.mjs';
import { tier as computeTier } from '../classify-work-mode.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORTALS_PATH = join(ROOT, 'portals.yml');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const OUT_DIR = join(ROOT, 'data');

const RA_RELEVANT_RE = /\b(regulatory|reg(\s|-)?affairs|assuntos\s*regulat[oó]rio|regulat[oó]ri[oa])\b/i;
const BUDGET_PER_TENANT_MS = 5 * 60 * 1000; // 5min/tenant cap

/**
 * Extract req_id from URL or externalPath (mirror logic from
 * providers/workday.mjs dedupByReqId — must agree for diff consistency).
 *
 * @param {string} urlOrPath
 * @returns {string}
 */
function extractReqId(urlOrPath) {
  if (typeof urlOrPath !== 'string') return '';
  const m = urlOrPath.match(/\/job\/[^/]+\/(.+?)$/);
  const tail = m ? m[1] : urlOrPath;
  const idMatch = tail.match(/_([A-Z0-9-]+)(?:[-_]\d+)?$/i);
  if (idMatch && idMatch[1]) return idMatch[1];
  const last = tail.split('_').pop();
  return last || urlOrPath;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function main() {
  // 1. Load portals
  const portalsRaw = readFileSync(PORTALS_PATH, 'utf8');
  /** @type {any} */
  const portals = yaml.load(portalsRaw);
  const entries = Array.isArray(portals?.tracked_companies) ? portals.tracked_companies : [];
  process.stderr.write(`[cp4-fase-a] loaded ${entries.length} entries from portals.yml\n`);

  // 2. Filter to Workday-direct: scan.mjs resolveProvider() does NOT check
  // scan_method — it iterates providers in load order; first detect() hit wins.
  // So mirror that exactly: workday.detect() returning non-null = Workday-direct.
  // scan_method:websearch on these entries is documentation/note only; scan.mjs
  // would attempt Workday API regardless. Failures (Cloudflare, 404 on Lilly,
  // 500 on Viatris) get captured downstream as errors.
  const workdayEntries = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    try {
      const hit = workday.detect(e);
      if (hit && hit.url) workdayEntries.push(e);
    } catch { /* skip */ }
  }
  process.stderr.write(`[cp4-fase-a] ${workdayEntries.length} Workday-direct tenants resolved\n`);
  for (const e of workdayEntries) {
    process.stderr.write(`  - ${e.name}: ${e.careers_url}\n`);
  }

  // 3. Probe each tenant
  const ctx = { fetchJson };
  /** @type {Array<{entry:any, total:number, probeMs:number, error?:string}>} */
  const probeResults = [];
  for (const e of workdayEntries) {
    const t0 = Date.now();
    const hit = workday.detect(e);
    try {
      const data = await ctx.fetchJson(hit.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: String(e.search_text ?? 'Regulatory Affairs') }),
        timeoutMs: 15000,
        redirect: 'error',
      });
      const total = typeof data?.total === 'number' ? data.total : 0;
      const probeMs = Date.now() - t0;
      probeResults.push({ entry: e, total, probeMs });
      process.stderr.write(`  probe ${e.name}: total=${total} in ${probeMs}ms\n`);
    } catch (err) {
      probeResults.push({ entry: e, total: 0, probeMs: Date.now() - t0, error: String(err?.message || err).slice(0, 160) });
      process.stderr.write(`  probe ${e.name}: FAILED — ${String(err?.message || err).slice(0, 100)}\n`);
    }
  }

  // 4. Full fetch per tenant (within budget)
  /** @type {Array<{entry:any, jobs:any[], fetchMs:number, aborted?:boolean, error?:string}>} */
  const fetchResults = [];
  for (const p of probeResults) {
    if (p.error) {
      fetchResults.push({ entry: p.entry, jobs: [], fetchMs: 0, error: p.error });
      continue;
    }
    process.stderr.write(`\n[cp4-fase-a] fetching ${p.entry.name} (probe total=${p.total})...\n`);
    const t0 = Date.now();
    let aborted = false;
    /** @type {Promise<any[]>} */
    const fetchPromise = workday.fetch(p.entry, ctx);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => { aborted = true; reject(new Error(`BUDGET_EXCEEDED_${BUDGET_PER_TENANT_MS}ms`)); }, BUDGET_PER_TENANT_MS)
    );
    try {
      const jobs = await Promise.race([fetchPromise, timeoutPromise]);
      const fetchMs = Date.now() - t0;
      fetchResults.push({ entry: p.entry, jobs, fetchMs });
      process.stderr.write(`  ${p.entry.name}: ${jobs.length} jobs in ${(fetchMs / 1000).toFixed(1)}s\n`);
    } catch (err) {
      const fetchMs = Date.now() - t0;
      fetchResults.push({ entry: p.entry, jobs: [], fetchMs, aborted, error: String(err?.message || err).slice(0, 160) });
      process.stderr.write(`  ${p.entry.name}: ${aborted ? 'ABORTED budget' : 'ERROR'} — ${String(err?.message || err).slice(0, 100)}\n`);
    }
  }

  // 5. Parse pipeline.md → set of existing req_ids
  const pipelineRaw = readFileSync(PIPELINE_PATH, 'utf8');
  const pipelineEntries = parsePipelineEntries(pipelineRaw);
  /** @type {Set<string>} */
  const existingReqIds = new Set();
  for (const pe of pipelineEntries) {
    const rid = extractReqId(pe.url);
    if (rid) existingReqIds.add(rid);
  }
  process.stderr.write(`\n[cp4-fase-a] pipeline.md: ${pipelineEntries.length} entries, ${existingReqIds.size} unique req_ids\n`);

  // 6. Diff: NEW jobs = scan job whose req_id not in pipeline
  /** @type {Array<{job:any, company:string, reqId:string}>} */
  const newJobs = [];
  for (const fr of fetchResults) {
    for (const j of fr.jobs) {
      const rid = extractReqId(j.url);
      if (!existingReqIds.has(rid)) newJobs.push({ job: j, company: fr.entry.name, reqId: rid });
    }
  }
  process.stderr.write(`[cp4-fase-a] new entries (not in pipeline.md): ${newJobs.length}\n`);

  // 7. RA filter on title
  const newRA = newJobs.filter((n) => RA_RELEVANT_RE.test(n.job.title || ''));
  process.stderr.write(`[cp4-fase-a] RA-filtered new entries: ${newRA.length}\n`);

  // 8. Compute tier per new RA entry (workday provider sets work_mode/br_eligible
  // but not tier — that's filter-candidates.mjs's job downstream).
  for (const n of newRA) {
    n.tier = computeTier(n.job.work_mode || 'UNKNOWN', n.job.br_eligible || 'UNKNOWN');
  }
  // Sort: tier ASC, then title
  newRA.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (a.job.title || '').localeCompare(b.job.title || '');
  });

  // 9. Write report
  const ts = timestamp();
  const outPath = join(OUT_DIR, `cp4-fase-a-workday-discovery-${ts}.md`);
  /** @param {string} s */
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);

  const lines = [];
  lines.push(`# CP4 Fase A — Workday partial scan discovery (${ts})`);
  lines.push('');
  lines.push('**BLOCKED — awaiting Vitor sign-off on entries to add to ground truth.**');
  lines.push('');
  lines.push(`Generated by: scripts/cp4-fase-a-workday-scan.mjs`);
  lines.push(`Pipeline source: data/pipeline.md (${pipelineEntries.length} entries, ${existingReqIds.size} unique req_ids)`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Workday-direct tenants resolved: ${workdayEntries.length}`);
  lines.push(`- Tenants successfully scanned: ${fetchResults.filter((r) => !r.error).length}`);
  lines.push(`- Tenants with errors / budget abort: ${fetchResults.filter((r) => r.error).length}`);
  const totalJobs = fetchResults.reduce((s, r) => s + r.jobs.length, 0);
  lines.push(`- Total jobs aggregated (all RA + non-RA): ${totalJobs}`);
  lines.push(`- New entries (req_id not in pipeline.md): ${newJobs.length}`);
  lines.push(`- New entries RA-relevant (regex /regulatory|reg.affairs|assuntos.regulat/i): **${newRA.length}**`);
  lines.push('');

  lines.push('## Tenants probe + fetch results');
  lines.push('');
  lines.push('| tenant | probe total | fetch jobs | fetch time | notes |');
  lines.push('|---|---|---|---|---|');
  for (const fr of fetchResults) {
    const probe = probeResults.find((p) => p.entry === fr.entry);
    const probeTotal = probe?.total ?? '?';
    const fetchSecs = (fr.fetchMs / 1000).toFixed(1);
    const note = fr.aborted ? 'BUDGET_ABORTED' : (fr.error ? `ERR: ${esc(fr.error)}` : '');
    lines.push(`| ${esc(fr.entry.name)} | ${probeTotal} | ${fr.jobs.length} | ${fetchSecs}s | ${note} |`);
  }
  lines.push('');

  if (newRA.length > 0) {
    lines.push(`## NEW RA-relevant entries (${newRA.length}) — TOP ${Math.min(10, newRA.length)}`);
    lines.push('');
    lines.push('| # | company | tier | work_mode | br_eligible | role | url |');
    lines.push('|---|---|---|---|---|---|---|');
    const sample = newRA.slice(0, 10);
    for (let i = 0; i < sample.length; i++) {
      const n = sample[i];
      const j = n.job;
      lines.push(`| ${i + 1} | ${esc(n.company)} | ${n.tier} | ${esc(j.work_mode || 'UNKNOWN')} | ${esc(j.br_eligible || 'UNKNOWN')} | ${esc(j.title)} | ${esc(j.url)} |`);
    }
    lines.push('');

    if (newRA.length > 10) {
      lines.push(`### Remaining (${newRA.length - 10}) RA-relevant entries — full list`);
      lines.push('');
      lines.push('| # | company | tier | work_mode | br_eligible | role | url |');
      lines.push('|---|---|---|---|---|---|---|');
      for (let i = 10; i < newRA.length; i++) {
        const n = newRA[i];
        const j = n.job;
        lines.push(`| ${i + 1} | ${esc(n.company)} | ${n.tier} | ${esc(j.work_mode || 'UNKNOWN')} | ${esc(j.br_eligible || 'UNKNOWN')} | ${esc(j.title)} | ${esc(j.url)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('## NEW RA-relevant entries: 0');
    lines.push('');
    lines.push('No new RA-relevant entries discovered. Scan parity with pipeline.md, OR all new entries were filtered out by the RA regex.');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Vitor — sign-off needed');
  lines.push('');
  lines.push('Please review the NEW RA-relevant entries above and respond in chat with:');
  lines.push('- Which entries to APPROVE (add to pipeline.md + expand ground truth)');
  lines.push('- Which entries to DISCARD (false positives, off-scope, wrong seniority)');
  lines.push('- For each APPROVED, expected (tier, work_mode, br_eligible) ground-truth values');
  lines.push('');
  lines.push('After your sign-off, CP4 Fase B proceeds (pipeline.md write + ground-truth expansion doc), then Fase C (full scan + smoke test) + Fase D (final handoff).');
  lines.push('');

  writeFileSync(outPath, lines.join('\n'), 'utf8');
  process.stdout.write(outPath + '\n');
  process.stderr.write(`\n[cp4-fase-a] report written: ${outPath}\n`);
}

main().catch((e) => { process.stderr.write(`Fatal: ${e.message}\n${e.stack}\n`); process.exit(1); });
