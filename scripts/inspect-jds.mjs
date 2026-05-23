#!/usr/bin/env node
// @ts-check
/**
 * inspect-jds.mjs — extract work_mode + location + BR eligibility from JD URLs.
 *
 * STRATEGY:
 *   1. PRIMARY: parse JSON-LD JobPosting schema (most reliable for ATSes that
 *      expose it — Phenom, some Workday, SmartRecruiters).
 *      Fields: jobLocation.address, jobLocationType (TELECOMMUTE = remote),
 *              applicantLocationRequirements, employmentType.
 *   2. FALLBACK: regex body innerText for PT/EN work-mode keywords.
 *
 * USAGE:
 *   node scripts/inspect-jds.mjs <url1> [url2 ...]
 *   echo -e "url1\nurl2" | node scripts/inspect-jds.mjs --stdin
 *
 * OUTPUT (stdout, markdown table):
 *   | url | location_real | work_mode | br_eligible | tier | evidence |
 *
 * Tier mapping (Vitor's policy, decrescente):
 *   Tier 1: REMOTE + BR_OK
 *   Tier 2: HYBRID + BR_OK OR REMOTE EU-eligible
 *   Tier 3: ON_SITE BR OR HYBRID EU
 *   Tier 4: ON_SITE non-BR OR RELOCATION_REQUIRED
 *
 * NOTES:
 *   - Sequential to avoid Phenom rate limit / Playwright concurrency issues.
 *   - waitUntil: 'domcontentloaded' (networkidle exceeded 30s on IQVIA).
 *   - Helper is provider-agnostic — works on any JD URL.
 */

import { chromium } from 'playwright';

const REMOTE_RE = /\b(remot[oae]?|home\s*office|home-?based|teletrabalho|trabalho\s*remoto|fully\s*remote|telework|WFH|work\s*from\s*home|global\s*remote|anywhere)\b/i;
const HYBRID_RE = /\b(h[ií]brido|hybrid)\b/i;
const ONSITE_RE = /\b(presencial|on[\s-]?site|in[\s-]?office|100%\s*on[\s-]?site)\b/i;
const MODELO_TRABALHO_RE = /modelo\s*de\s*trabalho\s*[:\-]?\s*([^\n.,]{3,60})/i;

const BR_LOCATION_RE = /\b(brasil|brazil|s[aã]o\s*paulo|rio\s*de\s*janeiro|campinas|jarinu|barueri|guarulhos|santo\s*andr[eé])\b/i;
const RELOC_RE = /\b(must\s*relocate|requires\s*relocation|relocation\s*required|relocate\s*to|must\s*be\s*located\s*in)\b/i;

/**
 * @param {string} html
 * @returns {Array<object>}
 */
function extractJsonLdBlocks(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) {
        for (const p of parsed) out.push(p);
      } else {
        out.push(parsed);
      }
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * @param {Array<object>} blocks
 */
function findJobPosting(blocks) {
  for (const b of blocks) {
    const t = b?.['@type'];
    if (t === 'JobPosting') return b;
    if (Array.isArray(t) && t.includes('JobPosting')) return b;
  }
  return null;
}

/**
 * @param {object} jp — JobPosting JSON-LD
 */
function parseJobPosting(jp) {
  const out = {
    locality: null,
    region: null,
    country: null,
    locationType: null,
    applicantLocations: [],
    employmentType: null,
    allCountries: [], // every country across jobLocation[] entries (multi-country remote roles)
    allLocations: [], // "{locality}, {country}" for each entry
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
 * @param {string} text — body innerText
 */
function classifyFromText(text) {
  const remoteMatch = text.match(REMOTE_RE);
  const hybridMatch = text.match(HYBRID_RE);
  const onsiteMatch = text.match(ONSITE_RE);
  const modeloMatch = text.match(MODELO_TRABALHO_RE);

  let work_mode = 'UNKNOWN';
  let evidence = 'JD silent on work mode';

  if (modeloMatch) {
    const val = modeloMatch[1].toLowerCase();
    if (/remot/.test(val)) work_mode = 'REMOTE';
    else if (/h[ií]br/.test(val)) work_mode = 'HYBRID';
    else if (/presenc/.test(val)) work_mode = 'ON_SITE';
    evidence = `"modelo de trabalho: ${modeloMatch[1].trim()}"`;
  } else if (hybridMatch) {
    work_mode = 'HYBRID';
    evidence = `body match: "${hybridMatch[0]}"`;
  } else if (remoteMatch && !onsiteMatch) {
    work_mode = 'REMOTE';
    evidence = `body match: "${remoteMatch[0]}"`;
  } else if (onsiteMatch && !remoteMatch) {
    work_mode = 'ON_SITE';
    evidence = `body match: "${onsiteMatch[0]}"`;
  } else if (remoteMatch && onsiteMatch) {
    work_mode = 'UNKNOWN';
    evidence = `ambiguous: both "${remoteMatch[0]}" and "${onsiteMatch[0]}" present`;
  }

  return { work_mode, evidence };
}

/**
 * @param {object} jp — parsed JobPosting fields
 * @param {string} bodyText — body innerText (for fallback + BR check)
 */
function classify(jp, bodyText) {
  // PRIMARY: JSON-LD jobLocationType
  let work_mode = 'UNKNOWN';
  let evidence = '';
  if (jp.locationType === 'TELECOMMUTE') {
    work_mode = 'REMOTE';
    evidence = 'JSON-LD jobLocationType=TELECOMMUTE';
  } else if (jp.locationType) {
    evidence = `JSON-LD jobLocationType="${jp.locationType}"`;
  }
  // SECONDARY: regex over body
  if (work_mode === 'UNKNOWN') {
    const textCls = classifyFromText(bodyText);
    work_mode = textCls.work_mode;
    evidence = textCls.evidence;
  }
  // If we still have UNKNOWN and city is BR + no remote indicator, lean ON_SITE
  if (work_mode === 'UNKNOWN' && jp.locality && BR_LOCATION_RE.test(jp.locality + ' ' + (jp.region || '') + ' ' + (jp.country || ''))) {
    // not enough signal — keep UNKNOWN, but evidence shows BR location
    evidence = `JSON-LD address=${jp.locality}/${jp.region}/${jp.country}; ${evidence}`;
  }

  // br_eligible
  let br_eligible = 'UNKNOWN';
  const allLocsStr = jp.allLocations.join(' | ');
  const applicantStr = jp.applicantLocations.join(' ');
  const isBRAddr = BR_LOCATION_RE.test(allLocsStr);
  const isBRApplicant = BR_LOCATION_RE.test(applicantStr);
  const isBRBody = BR_LOCATION_RE.test(bodyText.slice(0, 2000));
  const isRelocBody = RELOC_RE.test(bodyText);
  // BR present in ANY jobLocation country
  const anyBR = jp.allCountries.some((c) => /brazil|brasil|^br$/i.test(c));
  // All countries non-BR (geo-restricted remote)
  const hasCountries = jp.allCountries.length > 0;
  const allNonBR = hasCountries && !anyBR;

  if (work_mode === 'REMOTE') {
    if (anyBR || isBRApplicant) br_eligible = 'BR_OK';
    else if (allNonBR) br_eligible = 'RELOCATION_REQUIRED'; // country-restricted remote
    else if (jp.applicantLocations.length > 0) br_eligible = isBRApplicant ? 'BR_OK' : 'RELOCATION_REQUIRED';
    else br_eligible = 'UNKNOWN'; // no signal either way
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
 * @param {string} work_mode
 * @param {string} br_eligible
 */
function tier(work_mode, br_eligible) {
  if (work_mode === 'REMOTE' && br_eligible === 'BR_OK') return 1;
  if (work_mode === 'HYBRID' && br_eligible === 'BR_OK') return 2;
  if (work_mode === 'REMOTE' && br_eligible !== 'RELOCATION_REQUIRED') return 2;
  if (work_mode === 'ON_SITE' && br_eligible === 'BR_OK') return 3;
  if (work_mode === 'HYBRID' && br_eligible === 'UNKNOWN') return 3;
  if (work_mode === 'UNKNOWN' && br_eligible === 'BR_OK') return 3; // BR-based, no relocation
  if (br_eligible === 'RELOCATION_REQUIRED') return 4;
  if (work_mode === 'ON_SITE' && br_eligible !== 'BR_OK') return 4;
  return 4; // default conservative
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 */
async function inspectOne(page, url) {
  const out = { url, location_real: '', work_mode: 'UNKNOWN', br_eligible: 'UNKNOWN', tier: 4, evidence: '', error: null };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1000);
    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const blocks = extractJsonLdBlocks(html);
    const jp = findJobPosting(blocks);

    if (jp) {
      const parsed = parseJobPosting(jp);
      const cls = classify(parsed, bodyText);
      out.work_mode = cls.work_mode;
      out.br_eligible = cls.br_eligible;
      out.evidence = cls.evidence;
      // Show all countries when multiple (remote roles often list 5-10 EU countries)
      if (parsed.allCountries.length > 1) {
        const unique = [...new Set(parsed.allCountries)];
        out.location_real = `${parsed.locality || 'Remote'} in ${unique.length} countries [${unique.slice(0, 8).join(', ')}${unique.length > 8 ? ', ...' : ''}]`;
      } else {
        const locParts = [parsed.locality, parsed.region, parsed.country].filter(Boolean);
        out.location_real = locParts.join(', ') || '(not in JSON-LD)';
      }
      if (parsed.applicantLocations.length > 0) {
        out.evidence += ` | applicantLocations=[${parsed.applicantLocations.slice(0, 3).join(', ')}]`;
      }
    } else {
      // No JSON-LD → fallback to text only
      const cls = classifyFromText(bodyText);
      out.work_mode = cls.work_mode;
      out.evidence = `no JSON-LD; ${cls.evidence}`;
      // try to infer location from page title or first 500 chars
      const head = bodyText.slice(0, 800);
      const brMatch = head.match(BR_LOCATION_RE);
      if (brMatch) {
        out.location_real = brMatch[0];
        out.br_eligible = 'BR_OK';
      } else {
        out.location_real = '(not detected)';
      }
    }
    out.tier = tier(out.work_mode, out.br_eligible);
  } catch (err) {
    out.error = err?.message?.slice(0, 120) || String(err);
    out.evidence = `ERROR: ${out.error}`;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let urls = [];
  if (args.includes('--stdin')) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    urls = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else {
    urls = args.filter((a) => /^https?:\/\//.test(a));
  }
  if (urls.length === 0) {
    console.error('Usage: node scripts/inspect-jds.mjs <url1> [url2 ...]');
    console.error('   or: node scripts/inspect-jds.mjs --stdin');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 career-ops-inspect',
  });
  const page = await ctx.newPage();

  const results = [];
  let i = 0;
  for (const url of urls) {
    i++;
    process.stderr.write(`[${i}/${urls.length}] ${url.slice(0, 80)}...\n`);
    const r = await inspectOne(page, url);
    process.stderr.write(`  → tier=${r.tier} work_mode=${r.work_mode} br_eligible=${r.br_eligible}\n`);
    results.push(r);
  }
  await browser.close();

  // Sort ASC by tier
  results.sort((a, b) => a.tier - b.tier);

  console.log('\n| tier | work_mode | br_eligible | location_real | url | evidence |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    const marker = r.tier === 1 ? '🎯 1' : String(r.tier);
    const ev = (r.evidence || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 200);
    const loc = (r.location_real || '').replace(/\|/g, '\\|').slice(0, 60);
    const url = r.url.length > 80 ? r.url.slice(0, 77) + '...' : r.url;
    console.log(`| ${marker} | ${r.work_mode} | ${r.br_eligible} | ${loc} | ${url} | ${ev} |`);
  }

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of results) counts[r.tier] = (counts[r.tier] || 0) + 1;
  console.log(`\nSummary: Tier1=${counts[1]} Tier2=${counts[2]} Tier3=${counts[3]} Tier4=${counts[4]}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
