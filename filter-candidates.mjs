// @ts-check
/**
 * filter-candidates.mjs — rank + filter candidate jobs by Vitor's policy.
 *
 * Primary sort:    tier ASC (1=best, 4=worst) — combines work_mode + br_eligible
 * Secondary sort:  seniority match score DESC (Coord/Sr Assoc/Specialist/Manager-no-people > Sr Manager > others)
 * Tertiary sort:   recency DESC (line index in pipeline.md = discovery order; later = newer)
 *
 * Hard constraints (rows REMOVED, not ranked):
 *   - Seniority `Director+` → EXCLUDED (Director / Sr Director / VP / Head / Chief / Associate Director / Executive Director)
 *   - Salary tier floor disclose < floor → EXCLUDED (Parexel protection)
 *     • Tier1 EU Western (UK/IE/FR/DE/CH/NL/BE/AT): 60k floor (EUR/GBP/CHF)
 *     • Tier2 Southern EU (PT/ES/IT/GR): 45k floor (EUR)
 *     • Tier3 Eastern EU (PL/CZ/HU/RO/BG/HR/SK/SI/LT/LV/EE/SRB/UKR): 35k floor (EUR)
 *     • BR: no floor (cost of living differs)
 *     Salary only triggers exclusion when JD explicitly discloses a numeric range
 *     below the floor. Silent JDs pass through (most JDs don't disclose).
 *
 * Inputs accepted:
 *   - Array of Job objects (with work_mode/br_eligible/tier set by parsers v2)
 *   - Pipeline.md text → parsed via parsePipelineEntries
 *
 * Public API:
 *   filterCandidates(jobs, opts) → { ranked, excluded, stats }
 *   parsePipelineEntries(text)   → Array<ParsedEntry>
 *   computeSeniorityScore(title) → number
 *   shouldExcludeSeniority(title)→ boolean
 *   checkSalaryFloor(jdText, countryHint) → { excluded: boolean, reason: string }
 */

import { tier as computeTier } from './classify-work-mode.mjs';

/** @typedef {import('./providers/_types.js').WorkMode} WorkMode */
/** @typedef {import('./providers/_types.js').BrEligible} BrEligible */

const DIRECTOR_PLUS_RE = /\b(director|associate\s+director|sr\.?\s*director|senior\s+director|executive\s+director|vp|vice[\s-]?president|head\s+of|chief|c[eo]o|cto|cfo)\b/i;

// Higher score = closer to Vitor's sweet spot.
// Coord / Sr Associate / Specialist / Manager-no-people are top targets.
const SENIORITY_PATTERNS = [
  { score: 100, re: /\b(senior\s+associate|sr\.?\s*associate)\b/i },           // Sr Associate
  { score: 100, re: /\b(specialist|especialista|officer|coordenador|coordinator)\b/i }, // Specialist / Coord / Officer
  { score: 90,  re: /\b(supervisor|principal)\b/i },                            // Supervisor / Principal IC
  { score: 85,  re: /\b(manager)\b(?!\s+of\s+\w+\s+(team|people))/i },          // Manager (avoid "Manager of X People/Team")
  { score: 70,  re: /\b(senior\s+manager|sr\.?\s*manager)\b/i },                // Sr Manager (stretch)
  { score: 60,  re: /\b(analyst|analista)\b/i },                                // Analyst (junior)
  { score: 40,  re: /\b(associate)\b/i },                                       // Associate alone (junior)
  { score: 20,  re: /\b(intern|estagi[aá]rio|trainee|junior|jr\.?)\b/i },       // Intern / Junior
];

const SALARY_RE = /(?:salary|salário|salario|annual\s+salary|compensation|comp\s+range|base\s+pay)[^\n.]{0,80}?(\$|€|£|EUR|USD|GBP|CHF|R\$|BRL)\s*(\d{2,3})[,.\s]?(\d{3})/i;
const SALARY_K_RE = /(?:salary|salário|salario|annual\s+salary|compensation)[^\n.]{0,80}?(\$|€|£|EUR|USD|GBP|CHF|R\$|BRL)?\s*(\d{2,3})k\b/i;

const COUNTRY_TIER_FLOOR = {
  // Tier1 Western EU — 60k floor
  'United Kingdom': 60000, 'UK': 60000, 'Ireland': 60000, 'France': 60000,
  'Germany': 60000, 'Switzerland': 60000, 'Netherlands': 60000, 'Belgium': 60000, 'Austria': 60000,
  // Tier2 Southern EU — 45k floor
  'Portugal': 45000, 'Spain': 45000, 'Italy': 45000, 'Greece': 45000,
  // Tier3 Eastern EU — 35k floor
  'Poland': 35000, 'Czechia': 35000, 'Hungary': 35000, 'Romania': 35000,
  'Bulgaria': 35000, 'Croatia': 35000, 'Slovakia': 35000, 'Slovenia': 35000,
  'Lithuania': 35000, 'Latvia': 35000, 'Estonia': 35000, 'Serbia': 35000, 'Ukraine': 35000,
  // BR — no floor
};

const V2_SUFFIX_RE = /T=(\d)\s+wm=(\w+)\s+br=(\w+)(?:\s+loc=(.+))?$/;
// V21 — each token independently optional (anchor to start of parts[4],
// not whole line; tokens are space-separated within parts[4]).
const V21_TOKEN_RES = {
  employment_type:        /(?:^|\s)et=([A-Z_]+)/,
  compensation_min:       /(?:^|\s)cmin=(\d+)/,
  compensation_max:       /(?:^|\s)cmax=(\d+)/,
  compensation_currency:  /(?:^|\s)ccy=([A-Z]{3})/,
  compensation_period:    /(?:^|\s)cper=([A-Z_]+)/,
  posted_at:              /(?:^|\s)posted=(\d{4}-\d{2}-\d{2})/,
  apply_url:              /(?:^|\s)apply=(https?:\/\/\S+)/,
};
const V21_EMPLOYMENT_TYPES = new Set(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY', 'UNKNOWN']);
const V21_COMP_PERIODS = new Set(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'UNKNOWN']);
const ENTRY_RE = /^- \[([ x])\] (.+)$/;
const URL_RE = /https?:\/\/[^\s|]+/;

/**
 * @param {string} title
 * @returns {boolean}
 */
export function shouldExcludeSeniority(title) {
  return DIRECTOR_PLUS_RE.test(title || '');
}

/**
 * @param {string} title
 * @returns {number} — 0 = no match (treated as junior/unknown)
 */
export function computeSeniorityScore(title) {
  if (!title) return 0;
  let best = 0;
  for (const { score, re } of SENIORITY_PATTERNS) {
    if (re.test(title) && score > best) best = score;
  }
  return best;
}

/**
 * Detect explicit salary disclosure under the geographic tier floor.
 *
 * @param {string} jdText  — JD body text (may be empty)
 * @param {string} country — country hint from location_real or address
 * @returns {{excluded: boolean, reason: string}}
 */
export function checkSalaryFloor(jdText, country) {
  if (!jdText || !country) return { excluded: false, reason: '' };
  const floor = COUNTRY_TIER_FLOOR[country] || COUNTRY_TIER_FLOOR[country?.replace(/^the\s+/i, '')] || 0;
  if (floor === 0) return { excluded: false, reason: '' };
  const matchFull = jdText.match(SALARY_RE);
  if (matchFull) {
    const big = parseInt(matchFull[2], 10);
    const small = parseInt(matchFull[3], 10);
    const total = big * 1000 + small;
    if (total < floor) {
      return { excluded: true, reason: `salary disclosed ${matchFull[1] || ''}${total} < ${country} floor ${floor}` };
    }
  }
  const matchK = jdText.match(SALARY_K_RE);
  if (matchK) {
    const k = parseInt(matchK[2], 10);
    const total = k * 1000;
    if (total < floor) {
      return { excluded: true, reason: `salary disclosed ${matchK[1] || ''}${k}k < ${country} floor ${floor}` };
    }
  }
  return { excluded: false, reason: '' };
}

/**
 * Parse pipeline.md text into entry records (v2 metadata aware).
 *
 * @param {string} text
 * @returns {Array<{idx: number, checked: boolean, url: string, company: string, title: string, tier: number|null, work_mode: WorkMode|null, br_eligible: BrEligible|null, location_real: string|null, employment_type: string|null, compensation_min: number|null, compensation_max: number|null, compensation_currency: string|null, compensation_period: string|null, posted_at: string|null, apply_url: string|null, raw: string}>}
 */
export function parsePipelineEntries(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(ENTRY_RE);
    if (!m) continue;
    const checked = m[1] === 'x';
    const rest = m[2];
    const url = rest.match(URL_RE)?.[0] || '';
    // Split by " | " (preserve v1 + v2 fields)
    const parts = rest.split(' | ').map((s) => s.trim());
    // parts[0] = url, parts[1] = company, parts[2] = title, parts[3]? = v2 metadata
    const company = parts[1] || '';
    const title = parts[2] || '';
    let tier = null, work_mode = null, br_eligible = null, location_real = null;
    const v2 = parts[3];
    if (v2) {
      const v2m = v2.match(V2_SUFFIX_RE);
      if (v2m) {
        tier = parseInt(v2m[1], 10);
        work_mode = /** @type {WorkMode} */ (v2m[2]);
        br_eligible = /** @type {BrEligible} */ (v2m[3]);
        location_real = v2m[4] || null;
      }
    }
    // v2.1 parse from parts[4] — each token independently optional.
    let employment_type = null, compensation_min = null, compensation_max = null,
        compensation_currency = null, compensation_period = null,
        posted_at = null, apply_url = null;
    const v21 = parts[4];
    if (v21 && v21.includes('=')) {
      const et = v21.match(V21_TOKEN_RES.employment_type);
      if (et && V21_EMPLOYMENT_TYPES.has(et[1])) employment_type = et[1];
      const cmin = v21.match(V21_TOKEN_RES.compensation_min);
      if (cmin) { const n = parseInt(cmin[1], 10); if (Number.isFinite(n)) compensation_min = n; }
      const cmax = v21.match(V21_TOKEN_RES.compensation_max);
      if (cmax) { const n = parseInt(cmax[1], 10); if (Number.isFinite(n)) compensation_max = n; }
      const ccy = v21.match(V21_TOKEN_RES.compensation_currency);
      if (ccy) compensation_currency = ccy[1];
      const cper = v21.match(V21_TOKEN_RES.compensation_period);
      if (cper && V21_COMP_PERIODS.has(cper[1])) compensation_period = cper[1];
      const posted = v21.match(V21_TOKEN_RES.posted_at);
      if (posted) posted_at = posted[1];
      const apply = v21.match(V21_TOKEN_RES.apply_url);
      if (apply) apply_url = apply[1];
    }
    out.push({
      idx: i, checked, url, company, title,
      tier, work_mode, br_eligible, location_real,
      employment_type, compensation_min, compensation_max,
      compensation_currency, compensation_period, posted_at, apply_url,
      raw: line,
    });
  }
  return out;
}

/**
 * Rank + filter candidate jobs.
 *
 * @param {Array<{title: string, url: string, company?: string, work_mode?: WorkMode, br_eligible?: BrEligible, location_real?: string, idx?: number, jd_text?: string}>} jobs
 * @param {object} [opts]
 * @param {boolean} [opts.includeDirector] — debug: keep Director+ in ranked output (default false = exclude)
 * @param {boolean} [opts.checkSalary]     — apply salary-floor hard constraint (default true)
 * @returns {{ranked: Array<object>, excluded: Array<{job: object, reason: string}>, stats: object}}
 */
export function filterCandidates(jobs, opts = {}) {
  const includeDirector = opts.includeDirector === true;
  const checkSalary = opts.checkSalary !== false;
  /** @type {Array<object>} */
  const enriched = [];
  /** @type {Array<{job: object, reason: string}>} */
  const excluded = [];

  for (const j of jobs) {
    if (!includeDirector && shouldExcludeSeniority(j.title)) {
      excluded.push({ job: j, reason: 'seniority: Director+ excluded' });
      continue;
    }
    if (checkSalary && j.jd_text) {
      // Extract country hint from location_real (last comma-separated token)
      const loc = j.location_real || '';
      const countryHint = loc.split(',').pop()?.trim() || '';
      const salaryCheck = checkSalaryFloor(j.jd_text, countryHint);
      if (salaryCheck.excluded) {
        excluded.push({ job: j, reason: salaryCheck.reason });
        continue;
      }
    }
    const wm = j.work_mode || 'UNKNOWN';
    const br = j.br_eligible || 'UNKNOWN';
    const tier = computeTier(wm, br);
    const senScore = computeSeniorityScore(j.title);
    enriched.push({ ...j, tier, senScore });
  }

  enriched.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;             // tier ASC
    if (a.senScore !== b.senScore) return b.senScore - a.senScore; // seniority DESC
    return (b.idx || 0) - (a.idx || 0);                          // recency DESC (later line = newer)
  });

  /** @type {Record<1|2|3|4, number>} */
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of enriched) tierCounts[/** @type {1|2|3|4} */ (e.tier)] = (tierCounts[e.tier] || 0) + 1;

  return {
    ranked: enriched,
    excluded,
    stats: {
      input: jobs.length,
      ranked: enriched.length,
      excluded: excluded.length,
      tier1: tierCounts[1],
      tier2: tierCounts[2],
      tier3: tierCounts[3],
      tier4: tierCounts[4],
    },
  };
}

// CLI mode — print ranked pipeline.md
const isMain = (() => {
  try {
    const here = new URL(import.meta.url).pathname;
    const argv1 = String(process.argv[1] || '').replace(/\\/g, '/');
    return here.endsWith(argv1) || argv1.endsWith(here);
  } catch {
    return false;
  }
})();

if (isMain) {
  const { readFileSync } = await import('node:fs');
  const args = process.argv.slice(2);
  const pipelinePath = args.find((a) => !a.startsWith('--')) || 'data/pipeline.md';
  const includeDirector = args.includes('--include-director');
  const showTop = parseInt(args.find((a) => a.startsWith('--top='))?.slice(6) || '20', 10);
  const raw = readFileSync(pipelinePath, 'utf8');
  const entries = parsePipelineEntries(raw).filter((e) => !e.checked);
  const result = filterCandidates(entries, { includeDirector, checkSalary: false });
  console.log(`\n=== Filter result (${pipelinePath}) ===`);
  console.log(`Input: ${result.stats.input} unchecked entries`);
  console.log(`Excluded (Director+): ${result.stats.excluded}`);
  console.log(`Ranked: ${result.stats.ranked} (T1=${result.stats.tier1} T2=${result.stats.tier2} T3=${result.stats.tier3} T4=${result.stats.tier4})`);
  console.log(`\n=== Top ${Math.min(showTop, result.ranked.length)} ===`);
  for (const [i, r] of result.ranked.slice(0, showTop).entries()) {
    console.log(`${(i + 1).toString().padStart(2)}. [T${r.tier} sen=${r.senScore}] ${r.company} | ${r.title}`);
    if (r.location_real) console.log(`    loc=${r.location_real}`);
    console.log(`    ${r.url}`);
  }
}
