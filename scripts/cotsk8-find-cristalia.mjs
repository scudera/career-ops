#!/usr/bin/env node
// Find the actual careerPageName for Cristália + MCassab (URL slugs are
// cristalia and mcassabnutricaoesaudeanimal, but API doesn't return on those).
// Strategy: search by jobName + filter by careerPageUrl pattern.
const tests = [
  { jobName: 'regulat', tenant: 'cristalia' },
  { jobName: 'analista', tenant: 'cristalia' },
  { jobName: 'regulat', tenant: 'mcassab' },
];
for (const t of tests) {
  const url = `https://employability-portal.gupy.io/api/v1/jobs?jobName=${encodeURIComponent(t.jobName)}&limit=100`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const j = await r.json();
  const matches = (j.data || []).filter((row) => (row.careerPageUrl || '').toLowerCase().includes(t.tenant));
  console.log(`tenant=${t.tenant} jobName=${t.jobName}: found ${matches.length} matches`);
  for (const m of matches.slice(0, 2)) {
    console.log(`  careerPageName="${m.careerPageName}" careerPageId=${m.careerPageId} subdomain=${m.careerPageUrl.match(/https:\/\/([^.]+)/)?.[1]}`);
  }
}
