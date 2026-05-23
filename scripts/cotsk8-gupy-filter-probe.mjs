#!/usr/bin/env node
// Probe careerPageName case sensitivity + matching for 3 BR pharma tenants.
const cases = ['brainfarma', 'Brainfarma', 'BRAINFARMA', 'cristalia', 'Cristália', 'mcassabnutricaoesaudeanimal', 'mcassab'];
for (const c of cases) {
  try {
    const r = await fetch('https://employability-portal.gupy.io/api/v1/jobs?careerPageName=' + encodeURIComponent(c) + '&limit=2', { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const items = (j.data || []).length;
    const first = items > 0 ? j.data[0].careerPageName : '(none)';
    const url = items > 0 ? j.data[0].careerPageUrl : '';
    console.log(`careerPageName=${c} -> ${items} items, sample.careerPageName="${first}" url=${url.slice(0, 50)}`);
  } catch (e) {
    console.log(`careerPageName=${c} FAIL ${e.message}`);
  }
}
