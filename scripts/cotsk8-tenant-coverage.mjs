#!/usr/bin/env node
// Probe API coverage for several portals.yml tenants.
const tenants = ['Brainfarma','Eurofarma','Hypera Pharma','Hypera','Cristalia','Cristália','Libbs','Libbs Farmacêutica','Prati-Donaduzzi','Suzano','Biolab','Biolab Sanus','Daiichi Sankyo','MCassab','MCassab Nutrição e Saúde Animal','Ourofino','ALS Life Sciences','Viveo','Engepack','Legrand'];
for (const t of tenants) {
  const u = 'https://employability-portal.gupy.io/api/v1/jobs?careerPageName=' + encodeURIComponent(t) + '&limit=1';
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  const j = await r.json();
  const n = (j.data || []).length;
  const total = j.pagination?.total ?? '?';
  const sample = n > 0 ? `name="${j.data[0].careerPageName}" id=${j.data[0].careerPageId}` : '';
  console.log(`careerPageName="${t}" -> ${n} items (total=${total}) ${sample}`);
}
