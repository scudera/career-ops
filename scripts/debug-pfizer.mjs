#!/usr/bin/env node
// Debug Pfizer paginate behavior — print page-by-page counts and first req_ids.
import { fetchJson } from '../providers/_http.mjs';

const endpoint = 'https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs';
let offset = 0;
let total = 0;
const allPaths = [];
while (offset <= 2000) {
  const data = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
    timeoutMs: 15000,
    redirect: 'error',
  });
  total = data?.total ?? total;
  const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
  process.stdout.write(`offset=${offset} got=${postings.length} total=${total} firstPath=${postings[0]?.externalPath || '(none)'}\n`);
  if (postings.length === 0) break;
  for (const p of postings) allPaths.push(p.externalPath);
  offset += 20;
  if (offset >= total) break;
}
process.stdout.write(`\nTotal paths collected: ${allPaths.length}\n`);
const unique = new Set(allPaths);
process.stdout.write(`Unique paths: ${unique.size}\n`);
