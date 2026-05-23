// @ts-check
/**
 * classify-work-mode.mjs — shared helper for work_mode + br_eligible + tier
 * classification across providers, inspect-jds, filter-candidates, and
 * migrate-pipeline-schema scripts.
 *
 * STRATEGY:
 *   1. PRIMARY: parse JSON-LD JobPosting schema. Most reliable for ATSes that
 *      expose it (Phenom, some Workday, SmartRecruiters).
 *      Fields: jobLocation[].address.* (multi-location), jobLocationType
 *      (TELECOMMUTE = remote), applicantLocationRequirements, employmentType.
 *   2. FALLBACK: regex body innerText for PT/EN work-mode keywords.
 *
 * Provider-native sources (Gupy `workplaceType`, Workable `workplace_type`)
 * can call `classifyFromEnum` directly with the enum value, skipping the
 * JSON-LD + body inspection.
 *
 * @typedef {('REMOTE'|'HYBRID'|'ON_SITE'|'UNKNOWN')} WorkMode
 * @typedef {('BR_OK'|'RELOCATION_REQUIRED'|'UNKNOWN')} BrEligible
 *
 * @typedef {object} Classification
 * @property {WorkMode}   work_mode
 * @property {BrEligible} br_eligible
 * @property {1|2|3|4}    tier
 * @property {string}     location_real
 * @property {string}     evidence
 */

const REMOTE_RE = /\b(remot[oae]?|home\s*office|home-?based|teletrabalho|trabalho\s*remoto|fully\s*remote|telework|WFH|work\s*from\s*home|global\s*remote|anywhere)\b/i;
const HYBRID_RE = /\b(h[ií]brido|hybrid)\b/i;
const ONSITE_RE = /\b(presencial|on[\s-]?site|in[\s-]?office|100%\s*on[\s-]?site)\b/i;
const MODELO_TRABALHO_RE = /modelo\s*de\s*trabalho\s*[:\-]?\s*([^\n.,]{3,60})/i;

const BR_LOCATION_RE = /\b(brasil|brazil|s[aã]o\s*paulo|rio\s*de\s*janeiro|campinas|jarinu|barueri|guarulhos|santo\s*andr[eé])\b/i;
const RELOC_RE = /\b(must\s*relocate|requires\s*relocation|relocation\s*required|relocate\s*to|must\s*be\s*located\s*in)\b/i;

/**
 * Map a provider-native enum value to canonical WorkMode.
 * Used by Gupy (`workplaceType`), Workable (`workplace_type`),
 * SmartRecruiters (`location.remote`/`location.hybrid` flags).
 *
 * @param {string} raw
 * @returns {WorkMode}
 */
export function workModeFromEnum(raw) {
  if (typeof raw !== 'string') return 'UNKNOWN';
  const t = raw.trim().toLowerCase();
  if (!t) return 'UNKNOWN';
  if (/^remote$/.test(t) || t === 'remoto' || /telecommute/.test(t)) return 'REMOTE';
  if (/^hybrid$/.test(t) || /^h[ií]brid/.test(t)) return 'HYBRID';
  if (/^on[-_\s]?site$/.test(t) || /^presenc/.test(t) || /^office$/.test(t)) return 'ON_SITE';
  return 'UNKNOWN';
}

/**
 * Extract all JSON-LD JobPosting blocks from HTML.
 *
 * @param {string} html
 * @returns {Array<object>}
 */
export function extractJsonLdBlocks(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * @param {Array<object>} blocks
 * @returns {object|null}
 */
export function findJobPosting(blocks) {
  for (const b of blocks) {
    const t = b?.['@type'];
    if (t === 'JobPosting') return b;
    if (Array.isArray(t) && t.includes('JobPosting')) return b;
  }
  return null;
}

/**
 * Parse a JobPosting JSON-LD into structured fields. Multi-location aware.
 *
 * @param {object} jp
 */
export function parseJobPosting(jp) {
  const out = {
    locality: null,
    region: null,
    country: null,
    locationType: null,
    applicantLocations: [],
    employmentType: null,
    allCountries: [],
    allLocations: [],
  };
  out.locationType = jp.jobLocationType || null;
  out.employmentType = jp.employmentType || null;
  const locs = Array.isArray(jp.jobLocation) ? jp.jobLocation : (jp.jobLocation ? [jp.jobLocation] : []);
  for (let i = 0; i < locs.length; i++) {
    const addr = locs[i]?.address || {};
    if (i === 0) {
      out.locality = addr.addressLocality || null;
      out.region = addr.addressRegion || null;
      out.country = addr.addressCountry || null;
    }
    if (addr.addressCountry) out.allCountries.push(addr.addressCountry);
    const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
    if (parts.length > 0) out.allLocations.push(parts.join(', '));
  }
  const alr = jp.applicantLocationRequirements;
  if (alr) {
    const arr = Array.isArray(alr) ? alr : [alr];
    for (const a of arr) {
      const name = a?.name || a;
      if (name) out.applicantLocations.push(String(name));
    }
  }
  return out;
}

/**
 * Regex-based work_mode classification from body text. Fallback when no
 * JSON-LD or no provider-native enum available.
 *
 * @param {string} text
 * @returns {{work_mode: WorkMode, evidence: string}}
 */
export function classifyFromText(text) {
  if (typeof text !== 'string' || !text) {
    return { work_mode: 'UNKNOWN', evidence: 'empty body text' };
  }
  const remoteMatch = text.match(REMOTE_RE);
  const hybridMatch = text.match(HYBRID_RE);
  const onsiteMatch = text.match(ONSITE_RE);
  const modeloMatch = text.match(MODELO_TRABALHO_RE);

  if (modeloMatch) {
    const val = modeloMatch[1].toLowerCase();
    let work_mode = 'UNKNOWN';
    if (/remot/.test(val)) work_mode = 'REMOTE';
    else if (/h[ií]br/.test(val)) work_mode = 'HYBRID';
    else if (/presenc/.test(val)) work_mode = 'ON_SITE';
    return { work_mode, evidence: `"modelo de trabalho: ${modeloMatch[1].trim()}"` };
  }
  if (hybridMatch) return { work_mode: 'HYBRID', evidence: `body match: "${hybridMatch[0]}"` };
  if (remoteMatch && !onsiteMatch) return { work_mode: 'REMOTE', evidence: `body match: "${remoteMatch[0]}"` };
  if (onsiteMatch && !remoteMatch) return { work_mode: 'ON_SITE', evidence: `body match: "${onsiteMatch[0]}"` };
  if (remoteMatch && onsiteMatch) {
    return { work_mode: 'UNKNOWN', evidence: `ambiguous: both "${remoteMatch[0]}" and "${onsiteMatch[0]}" present` };
  }
  return { work_mode: 'UNKNOWN', evidence: 'JD silent on work mode' };
}

/**
 * Combine JSON-LD + body text into final classification.
 *
 * @param {ReturnType<typeof parseJobPosting>} jp
 * @param {string} bodyText
 * @returns {{work_mode: WorkMode, br_eligible: BrEligible, evidence: string}}
 */
export function classifyFromJsonLd(jp, bodyText) {
  let work_mode = 'UNKNOWN';
  let evidence = '';
  if (jp.locationType === 'TELECOMMUTE') {
    work_mode = 'REMOTE';
    evidence = 'JSON-LD jobLocationType=TELECOMMUTE';
  } else if (jp.locationType) {
    evidence = `JSON-LD jobLocationType="${jp.locationType}"`;
  }
  if (work_mode === 'UNKNOWN') {
    const t = classifyFromText(bodyText);
    work_mode = t.work_mode;
    evidence = t.evidence;
  }

  // br_eligible from JSON-LD multi-country + body fallback
  let br_eligible = 'UNKNOWN';
  const allLocsStr = jp.allLocations.join(' | ');
  const applicantStr = jp.applicantLocations.join(' ');
  const isBRAddr = BR_LOCATION_RE.test(allLocsStr);
  const isBRApplicant = BR_LOCATION_RE.test(applicantStr);
  const isBRBody = BR_LOCATION_RE.test(bodyText.slice(0, 2000));
  const isRelocBody = RELOC_RE.test(bodyText);
  const anyBR = jp.allCountries.some((c) => /brazil|brasil|^br$/i.test(c));
  const hasCountries = jp.allCountries.length > 0;
  const allNonBR = hasCountries && !anyBR;

  if (work_mode === 'REMOTE') {
    if (anyBR || isBRApplicant) br_eligible = 'BR_OK';
    else if (allNonBR) br_eligible = 'RELOCATION_REQUIRED';
    else if (jp.applicantLocations.length > 0) br_eligible = isBRApplicant ? 'BR_OK' : 'RELOCATION_REQUIRED';
    else br_eligible = 'UNKNOWN';
  } else if (work_mode === 'ON_SITE' || work_mode === 'HYBRID') {
    if (isBRAddr) br_eligible = 'BR_OK';
    else if (allNonBR || isRelocBody) br_eligible = 'RELOCATION_REQUIRED';
  } else {
    if (isBRAddr) br_eligible = 'BR_OK';
    else if (allNonBR) br_eligible = 'RELOCATION_REQUIRED';
  }

  return { work_mode, br_eligible, evidence };
}

/**
 * Tier mapping (CP1 schema-v2 + CP2 Risk #1 decision = REMOTE+UNKNOWN → Tier 3).
 *
 * @param {WorkMode} work_mode
 * @param {BrEligible} br_eligible
 * @returns {1|2|3|4}
 */
export function tier(work_mode, br_eligible) {
  if (work_mode === 'REMOTE' && br_eligible === 'BR_OK') return 1;
  if (work_mode === 'HYBRID' && br_eligible === 'BR_OK') return 2;
  if (work_mode === 'REMOTE' && br_eligible === 'UNKNOWN') return 3; // CP2 Risk #1
  if (work_mode === 'ON_SITE' && br_eligible === 'BR_OK') return 3;
  if (work_mode === 'HYBRID' && br_eligible === 'UNKNOWN') return 3;
  if (work_mode === 'UNKNOWN' && br_eligible === 'BR_OK') return 3;
  if (br_eligible === 'RELOCATION_REQUIRED') return 4;
  if (work_mode === 'ON_SITE' && br_eligible !== 'BR_OK') return 4;
  return 4; // conservative default
}

/**
 * Build canonical location_real string from parsed JSON-LD.
 *
 * @param {ReturnType<typeof parseJobPosting>} jp
 * @returns {string}
 */
export function locationReal(jp) {
  if (jp.allCountries.length > 1) {
    const unique = [...new Set(jp.allCountries)];
    return `${jp.locality || 'Remote'} in ${unique.length} countries [${unique.slice(0, 8).join(', ')}${unique.length > 8 ? ', ...' : ''}]`;
  }
  const parts = [jp.locality, jp.region, jp.country].filter(Boolean);
  return parts.join(', ') || '';
}

/**
 * Full-document classification: HTML + body text → Classification.
 *
 * @param {string} html
 * @param {string} bodyText
 * @returns {Classification}
 */
export function classifyFromHtml(html, bodyText) {
  const blocks = extractJsonLdBlocks(html);
  const jp = findJobPosting(blocks);
  if (jp) {
    const parsed = parseJobPosting(jp);
    const cls = classifyFromJsonLd(parsed, bodyText);
    const loc = locationReal(parsed);
    let evidence = cls.evidence;
    if (parsed.applicantLocations.length > 0) {
      evidence += ` | applicantLocations=[${parsed.applicantLocations.slice(0, 3).join(', ')}]`;
    }
    return {
      work_mode: cls.work_mode,
      br_eligible: cls.br_eligible,
      tier: tier(cls.work_mode, cls.br_eligible),
      location_real: loc || '(not in JSON-LD)',
      evidence,
    };
  }
  // No JSON-LD → text only
  const cls = classifyFromText(bodyText);
  let location_real = '(not detected)';
  let br_eligible = /** @type {BrEligible} */ ('UNKNOWN');
  const head = bodyText.slice(0, 800);
  const brMatch = head.match(BR_LOCATION_RE);
  if (brMatch) {
    location_real = brMatch[0];
    br_eligible = 'BR_OK';
  }
  return {
    work_mode: cls.work_mode,
    br_eligible,
    tier: tier(cls.work_mode, br_eligible),
    location_real,
    evidence: `no JSON-LD; ${cls.evidence}`,
  };
}

/**
 * Determine BR-eligibility from a structured (provider-native) location object.
 * Used by Gupy/Workable providers that have explicit workplace + city fields.
 *
 * @param {object} loc — { city, region, country, fullLocation }
 * @param {WorkMode} work_mode
 * @returns {BrEligible}
 */
export function brEligibleFromStructuredLocation(loc, work_mode) {
  if (!loc || typeof loc !== 'object') return 'UNKNOWN';
  const blob = [loc.city, loc.region, loc.country, loc.fullLocation].filter(Boolean).join(' ');
  if (BR_LOCATION_RE.test(blob)) return 'BR_OK';
  // explicit non-BR country → relocation
  if (loc.country && !/brazil|brasil|^br$/i.test(loc.country)) {
    return work_mode === 'REMOTE' ? 'RELOCATION_REQUIRED' : 'RELOCATION_REQUIRED';
  }
  return 'UNKNOWN';
}

/**
 * Dynamic DOM-stability wait — polls document.body.innerText.length until
 * it stops changing for `minStableMs`. Resolves Risk #2 (CP3 = Option C):
 * SPA hydration is non-deterministic, the previous fixed 2500ms wait was
 * flaky on slow Phenom/Workday loads and wasteful on fast ones.
 *
 * On TIMEOUT (>= maxWaitMs without ever stabilizing), returns { stable:false }
 * — caller MUST still proceed with classification on the partial DOM and log
 * the timeout in stderr.
 *
 * @param {import('playwright').Page} page
 * @param {{minStableMs?: number, maxWaitMs?: number, pollMs?: number}} [opts]
 * @returns {Promise<{stable: boolean, waitedMs: number, finalLen: number}>}
 */
/**
 * URL signatures of Phenom-based career sites. Used by the CP3.5 Fase B
 * defensive rule (Phenom Brazil placeholder fallback). Stable as of 2026-05.
 */
const PHENOM_URL_PATTERNS = [
  /jobs\.iqvia\.com\//i,
  /careers\.iconplc\.com\//i,
  /careers\.abbvie\.com\//i,
  /jobs\.parexel\.com\//i,
  /jobs\.thermofisher\.com\//i,
  /careers\.amgen\.com\//i,
  /careers\.chiesi\.com\//i,
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isPhenomURL(url) {
  if (typeof url !== 'string') return false;
  return PHENOM_URL_PATTERNS.some((re) => re.test(url));
}

export async function waitForStableDOM(page, opts = {}) {
  const {
    minStableMs = 500,
    maxWaitMs = 8000,
    pollMs = 200,
  } = opts;
  const start = Date.now();
  let lastLen = 0;
  let stableSince = 0;
  while (Date.now() - start < maxWaitMs) {
    const len = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (len === lastLen && len > 0) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= minStableMs) {
        return { stable: true, waitedMs: Date.now() - start, finalLen: len };
      }
    } else {
      stableSince = 0;
      lastLen = len;
    }
    await page.waitForTimeout(pollMs);
  }
  return { stable: false, waitedMs: maxWaitMs, finalLen: lastLen };
}

/**
 * Consensus voting across N independent classification runs of the same URL.
 * Each run is a full `page.goto + waitForStableDOM + classifyFromHtml` cycle —
 * CP3.5 resolves non-determinism exposed in CP3 (IQVIA R1519241 oscillating
 * HYBRID/Tier 2 ↔ REMOTE/Tier 1 across runs).
 *
 * Tier consensus rules:
 *   - 2+ runs concordam (majority on 3, or unanimous on N=runs)   → use that tier
 *   - Split (todos diferentes / nenhum atinge majority)            → conservative fallback = worst tier (Math.max)
 *
 * `work_mode` / `br_eligible` herda do PRIMEIRO run com tier-consenso.
 * (Tier number é o consenso, mas o (work_mode, br_eligible) underlying pode
 * variar entre runs do mesmo tier — caller deve tratar tier como mais
 * autoritativo do que os labels.)
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{runs?: number, delayBetweenMs?: number, navTimeoutMs?: number}} [opts]
 * @returns {Promise<Classification & {consensus: {confidence: 'unanimous'|'majority'|'split-fallback-conservative', runs: number, tierDistribution: Record<number, number>, allRuns: Array<{tier: number, work_mode: WorkMode, br_eligible: BrEligible, evidence: string}>}}>}
 */
export async function classifyWithConsensus(page, url, opts = {}) {
  const { runs = 3, delayBetweenMs = 500, navTimeoutMs = 45000 } = opts;
  /** @type {Array<Classification>} */
  const results = [];
  for (let i = 0; i < runs; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    await waitForStableDOM(page);
    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    results.push(classifyFromHtml(html, bodyText));
    if (i < runs - 1) await page.waitForTimeout(delayBetweenMs);
  }

  /** @type {Record<number, number>} */
  const tierDistribution = {};
  for (const r of results) tierDistribution[r.tier] = (tierDistribution[r.tier] || 0) + 1;
  const sortedTiers = Object.entries(tierDistribution).sort((a, b) => b[1] - a[1]);
  const topTier = parseInt(sortedTiers[0][0], 10);
  const topCount = sortedTiers[0][1];

  let consensusTier;
  /** @type {'unanimous'|'majority'|'split-fallback-conservative'} */
  let confidence;
  if (topCount === runs) {
    consensusTier = topTier;
    confidence = 'unanimous';
  } else if (topCount >= 2) {
    consensusTier = topTier;
    confidence = 'majority';
  } else {
    consensusTier = Math.max(...results.map((r) => r.tier));
    confidence = 'split-fallback-conservative';
  }

  const winningRun = results.find((r) => r.tier === consensusTier) || results[0];
  process.stderr.write(
    `[consensus] url=${url.slice(0, 90)} runs=${runs} winner=Tier-${consensusTier} confidence=${confidence} dist=${JSON.stringify(tierDistribution)}\n`
  );

  return {
    work_mode: winningRun.work_mode,
    br_eligible: winningRun.br_eligible,
    tier: /** @type {1|2|3|4} */ (consensusTier),
    location_real: winningRun.location_real,
    evidence: winningRun.evidence,
    consensus: {
      confidence,
      runs: results.length,
      tierDistribution,
      allRuns: results.map((r) => ({
        tier: r.tier,
        work_mode: r.work_mode,
        br_eligible: r.br_eligible,
        evidence: r.evidence,
      })),
    },
  };
}
