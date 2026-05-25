// One-shot script: populate tier: N on tracked_companies entries in portals.yml
// Idempotent: skips entries that already have tier:.
// portals.yml is User Layer (gitignored). This script is committable.
import { readFileSync, writeFileSync } from 'fs';

const path = 'portals.yml';
const tierMap = {
  // T1 — FAANG-tier global pharma
  'Pfizer': 1, 'Roche': 1, 'Novartis': 1, 'Sanofi': 1, 'GSK': 1, 'AstraZeneca': 1,
  'Johnson & Johnson': 1, 'MSD (Merck)': 1, 'AbbVie': 1, 'Bristol Myers Squibb': 1,
  'Bayer': 1, 'Eli Lilly': 1, 'Boehringer Ingelheim': 1, 'Novo Nordisk': 1,
  // T2 — large multinational pharma + flagship biotech
  'Takeda': 2, 'Astellas': 2, 'Amgen': 2, 'Gilead Sciences': 2, 'Biogen': 2,
  'Viatris': 2, 'Chiesi': 2, 'Ferring Pharmaceuticals': 2, 'Moderna': 2,
  'BeiGene (BeOne Medicines)': 2, 'Daiichi Sankyo': 2, 'UCB': 2, 'Lundbeck': 2,
  'Servier': 2,
  // T3 — CROs + dev-tier biotechs + tech adjacents
  'IQVIA': 3, 'ICON plc': 3, 'Parexel': 3, 'Labcorp': 3,
  'Thermo Fisher Scientific': 3, 'Veeva Systems': 3, 'Elanco': 3,
  'PPD': 3, 'Syneos': 3, 'Medpace': 3, 'Catalent': 3, 'Lonza': 3,
  // BR T2 — national leaders BR
  'Eurofarma': 2, 'Hypera Pharma': 2, 'EMS': 2, 'Ache': 2,
  'Cristalia Farmaceutica': 2, 'Libbs Farmaceutica': 2, 'Sandoz Brasil': 2,
  // BR T3 — mid BR pharma
  'Brainfarma': 3, 'Pinex': 3, 'Rennova': 3, 'Natulab': 3,
  'Aspen': 3, 'Apsen': 3, 'Mantecorp': 3, 'Biolab': 3, 'Blanver': 3,
  'Vyttra': 3, 'Hpbio': 3, 'Exeltis Brasil': 3,
  // T4 — niche/specialty/non-pharma adjacent
  'Kemin Industries': 4, 'AQIA Quimica Inovativa': 4,
  'Quality Compliance': 4, 'Meiskin': 4, 'Imex Medical': 4,
  // BR subsidiaries of T1 globals — keep T1 (BR market presence)
  'Pfizer Brasil': 1, 'Roche Brasil': 1, 'Novartis Brasil': 1, 'Sanofi Brasil': 1,
  'GSK Brasil': 1, 'AstraZeneca Brasil': 1, 'MSD Brasil': 1,
  'Bristol Myers Squibb Brasil': 1, 'Johnson & Johnson Brasil': 1,
  'Bayer Brasil': 1, 'Eli Lilly Brasil': 1, 'AbbVie Brasil': 1,
  'Abbott Brasil': 1, 'Novo Nordisk Brasil': 1,
  'Takeda Brasil': 2, 'Teva Brasil': 2, 'Medley (Sanofi)': 2,
  // BR T2/T3 Gupy duplicates (same tier as parent)
  'Brainfarma (Gupy)': 3, 'Eurofarma (Gupy)': 2, 'Hypera Pharma (Gupy)': 2,
  'Cristalia Farmaceutica (Gupy)': 2, 'Libbs Farmaceutica (Gupy)': 2,
  'Prati-Donaduzzi (Gupy)': 3, 'Daiichi Sankyo Brasil (Gupy)': 2,
  'Prati-Donaduzzi': 3, 'Cristalia': 2, 'Biolab Sanus': 3,
  'EMS Pharma': 2, 'Ache Laboratorios': 2,
  // CROs + niche
  'Fortrea': 3, 'PPD (Thermo Fisher)': 3, 'Labcorp Drug Development': 3,
  'Evotec': 3, 'Legrand Pharma': 4,
  // T4 — agro/vet/packaging/devices distantes de pharma RA core
  'ALS Life Sciences (Gupy)': 4, 'Ourofino Saude Animal (Gupy)': 4,
  'MCassab Nutricao e Saude Animal (Gupy)': 4, 'Engepack Embalagens (Gupy)': 4,
  'SIGVARIS GROUP Brasil (Gupy)': 4, 'Viveo (Gupy)': 4,
};

const content = readFileSync(path, 'utf-8');
const lines = content.split('\n');
const out = [];
let updated = 0;
let skippedNoMap = 0;
let skippedHasTier = 0;
let skippedNotTracked = 0;
const unmatched = [];

function normalize(s) {
  return s
    .replace(/['"]/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const normalizedMap = {};
for (const [k, v] of Object.entries(tierMap)) {
  normalizedMap[normalize(k).toLowerCase()] = v;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  out.push(line);
  const m = line.match(/^(\s*)- name:\s*(.+?)\s*$/);
  if (!m) continue;
  const indent = m[1];
  const name = m[2];
  const nKey = normalize(name).toLowerCase();
  // Sniff next ~8 lines to determine if this entry is tracked_companies (has careers_url)
  // and whether it already has tier:.
  let isTracked = false;
  let alreadyHasTier = false;
  const childIndent = indent + '  ';
  for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
    const next = lines[j];
    if (next.startsWith(indent + '- ')) break;
    if (next.startsWith(childIndent + 'careers_url:')) isTracked = true;
    if (next.startsWith(childIndent + 'tier:')) alreadyHasTier = true;
  }
  if (!isTracked) { skippedNotTracked++; continue; }
  if (alreadyHasTier) { skippedHasTier++; continue; }
  const tier = normalizedMap[nKey];
  if (tier == null) {
    skippedNoMap++;
    unmatched.push(name);
    continue;
  }
  out.push(`${childIndent}tier: ${tier}`);
  updated++;
}

writeFileSync(path, out.join('\n'));
console.log(`tier populated: ${updated} updated`);
console.log(`skipped: ${skippedHasTier} already had tier, ${skippedNoMap} tracked but no mapping, ${skippedNotTracked} not tracked (search entries)`);
if (unmatched.length) {
  console.log(`\nUnmapped tracked tenants (consider adding to tierMap):`);
  for (const u of unmatched) console.log(`  - ${u}`);
}
