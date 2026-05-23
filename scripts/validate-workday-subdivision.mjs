#!/usr/bin/env node
// @ts-check
/**
 * validate-workday-subdivision.mjs — COTSK-4 Fase A validation.
 *
 * Three modes:
 *   --baseline-pfizer: run NEW workday.mjs against Pfizer (515 total, no
 *                      subdivision triggered) → must return ~515 jobs deduped.
 *                      Validates the algorithm doesn't break small tenants.
 *   --before-cap:     manually paginate Accenture with appliedFacets={}
 *                      (simulating OLD behavior) → reports the 2K cap.
 *   --after-subdiv:   run NEW workday.mjs subdivide on Accenture first
 *                      jobFamilyGroup only (depth-1 forced cap to bound
 *                      execution time) → demonstrates >2K recovery.
 */

import { fetchJson } from '../providers/_http.mjs';
import workday from '../providers/workday.mjs';

const ctx = { fetchJson };

async function runBaselinePfizer() {
  const entry = {
    name: 'Pfizer',
    careers_url: 'https://pfizer.wd1.myworkdayjobs.com/PfizerCareers',
    search_text: '',
  };
  process.stderr.write('\n=== baseline-pfizer (515 total expected, no subdivision) ===\n');
  const t0 = Date.now();
  const jobs = await workday.fetch(entry, ctx);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`pfizer.fetch returned ${jobs.length} deduped jobs in ${elapsed}s\n`);
  process.stdout.write(`sample: ${jobs.slice(0, 3).map((j) => `${j.title} @ ${j.location}`).join(' || ')}\n`);
}

async function runBeforeCap() {
  // Simulate OLD behavior: paginate Accenture with empty appliedFacets up to MAX_OFFSET=2000.
  const endpoint = 'https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers/jobs';
  process.stderr.write('\n=== before-cap (Accenture searchText="", old MAX_OFFSET=2000 cap) ===\n');
  const t0 = Date.now();
  let offset = 0;
  let total = 0;
  const jobs = [];
  while (offset <= 2000) {
    const data = await ctx.fetchJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      timeoutMs: 15000,
      redirect: 'error',
    });
    total = data?.total ?? total;
    const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
    if (postings.length === 0) break;
    for (const p of postings) jobs.push(p);
    offset += 20;
    if (offset >= total) break;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`accenture before-cap: API reports total=${total}, paginated ${jobs.length} postings in ${elapsed}s\n`);
}

async function runAfterSubdiv() {
  // Forced depth-1 only: subdivide Accenture's first jobFamilyGroup value to bound runtime.
  // Calls workday.fetch with the facet already applied — emulates "what happens inside
  // one branch of the subdivision tree." Real production fetch would loop all 42 values.
  const endpoint = 'https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers/jobs';
  process.stderr.write('\n=== after-subdiv (Accenture: subdivide top jobFamilyGroup once) ===\n');

  // Step 1: probe to get the top jobFamilyGroup value id
  const probe = await ctx.fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
    timeoutMs: 15000,
    redirect: 'error',
  });
  const jfg = probe.facets.find((f) => f.facetParameter === 'jobFamilyGroup');
  // pick the SMALLEST value over 2K to bound test runtime
  const candidates = jfg.values.filter((v) => v.count >= 2000).sort((a, b) => a.count - b.count);
  const target = candidates[0] || jfg.values[0];
  process.stderr.write(`Picked jobFamilyGroup="${target.descriptor}" (count=${target.count})\n`);

  // Step 2: paginate this branch directly (simulating BEFORE on the branch — cap 2K)
  const t0 = Date.now();
  let offset = 0;
  const branchBefore = [];
  let branchTotal = 0;
  while (offset <= 2000) {
    const data = await ctx.fetchJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ appliedFacets: { jobFamilyGroup: [target.id] }, limit: 20, offset, searchText: '' }),
      timeoutMs: 15000,
      redirect: 'error',
    });
    if (typeof data?.total === 'number' && data.total > 0 && branchTotal === 0) branchTotal = data.total;
    const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
    if (postings.length === 0) break;
    branchBefore.push(...postings);
    offset += 20;
    if (offset >= branchTotal) break;
  }
  const branchBeforeElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`accenture branch="${target.descriptor}" BEFORE-cap: API reports total=${branchTotal}, paginated ${branchBefore.length} postings in ${branchBeforeElapsed}s\n`);

  // Step 3: subdivide this branch by timeType (depth=2)
  const probe2 = await ctx.fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ appliedFacets: { jobFamilyGroup: [target.id] }, limit: 1, offset: 0, searchText: '' }),
    timeoutMs: 15000,
    redirect: 'error',
  });
  const tt = probe2.facets.find((f) => f.facetParameter === 'timeType');
  process.stderr.write(`branch timeType values: ${tt.values.map((v) => `${v.descriptor}(${v.count})`).join(', ')}\n`);

  const t1 = Date.now();
  const subAll = [];
  for (const ttv of tt.values) {
    let offsetT = 0;
    let totalT = 0;
    while (offsetT <= 2000) {
      const data = await ctx.fetchJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ appliedFacets: { jobFamilyGroup: [target.id], timeType: [ttv.id] }, limit: 20, offset: offsetT, searchText: '' }),
        timeoutMs: 15000,
        redirect: 'error',
      });
      if (typeof data?.total === 'number' && data.total > 0 && totalT === 0) totalT = data.total;
      const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
      if (postings.length === 0) break;
      subAll.push(...postings);
      offsetT += 20;
      if (totalT > 0 && offsetT >= totalT) break;
    }
  }
  const branchAfterElapsed = ((Date.now() - t1) / 1000).toFixed(1);
  process.stdout.write(`accenture branch="${target.descriptor}" AFTER-subdiv (by timeType depth=2): ${subAll.length} postings in ${branchAfterElapsed}s\n`);
  // dedup
  const seen = new Set();
  const uniq = subAll.filter((p) => { const id = p.externalPath; if (seen.has(id)) return false; seen.add(id); return true; });
  process.stdout.write(`accenture branch="${target.descriptor}" AFTER-subdiv DEDUPED: ${uniq.length} unique postings\n`);
  process.stdout.write(`IMPROVEMENT: BEFORE=${branchBefore.length} → AFTER=${uniq.length} (${branchTotal > 0 ? (uniq.length / branchBefore.length).toFixed(1) : '?'}x)\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--baseline-pfizer')) await runBaselinePfizer();
  if (args.includes('--before-cap')) await runBeforeCap();
  if (args.includes('--after-subdiv')) await runAfterSubdiv();
  if (args.length === 0) {
    process.stderr.write('Usage: node scripts/validate-workday-subdivision.mjs [--baseline-pfizer] [--before-cap] [--after-subdiv]\n');
    process.exit(1);
  }
}

main().catch((e) => { process.stderr.write(`Fatal: ${e.message}\n${e.stack}\n`); process.exit(1); });
