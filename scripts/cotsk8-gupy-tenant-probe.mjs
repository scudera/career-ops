#!/usr/bin/env node
// Test per-tenant Gupy API endpoints (vs centralized employability-portal).
const tries = [
  // Centralized API filters
  'https://employability-portal.gupy.io/api/v1/jobs?careerPageUrl=brainfarma&limit=2',
  'https://employability-portal.gupy.io/api/v1/jobs?subdomain=brainfarma&limit=2',
  'https://employability-portal.gupy.io/api/v1/jobs?slug=brainfarma&limit=2',
  // Per-tenant subdomain API
  'https://brainfarma.gupy.io/api/v1/jobs?limit=2',
  'https://brainfarma.gupy.io/api/v1/jobs',
  'https://brainfarma.gupy.io/api/jobs',
  // Maybe career page name list to discover the right name
  'https://employability-portal.gupy.io/api/v1/career-pages?name=brainfarma',
];
for (const u of tries) {
  try {
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    const t = await r.text();
    let n = 0;
    let preview = '';
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j.data)) n = j.data.length;
      else if (Array.isArray(j)) n = j.length;
      preview = JSON.stringify(j).slice(0, 100);
    } catch { preview = t.slice(0, 80); }
    console.log(`HTTP ${r.status} items=${n} | ${u.slice(0, 90)}`);
    if (r.status === 200 && n > 0) console.log(`  preview: ${preview}`);
  } catch (e) { console.log(`FAIL ${e.message} | ${u.slice(0, 90)}`); }
}
