// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Schema v2 (CP2 22/may/26): Gupy `workplaceType` ('remote'|'hybrid'|'on-site')
// maps 1:1 to canonical WorkMode via classify-work-mode::workModeFromEnum.
// Tenant subdomain implies BR base → br_eligible defaults BR_OK; remote-only
// portals (rare) would still be BR_OK since Gupy hosts Brazilian companies.

import { workModeFromEnum, brEligibleFromStructuredLocation, employmentTypeFromEnum, truncateDateISO } from '../classify-work-mode.mjs';

// Gupy BR provider — API primary, NEXT_DATA SSR fallback (COTSK-8 23/may/26).
//
// PATH A (preferred): https://employability-portal.gupy.io/api/v1/jobs filtered
// by careerPageName (exact match, case-sensitive). Exposes publishedDate (ISO)
// → posted_at win. Covers ~9/20 known tenants. Description field stripped from
// payload before persistence (3-5K chars per job, memory hygiene).
//
// PATH B (fallback): Per-tenant Next.js SPA SSRs the full jobs array into
// `<script id="__NEXT_DATA__">`. One HTTP GET / tenant → full list. Used when
// API yields 0 hits (tenant not indexed by central API) or HTTP error.
//
// careerPageName resolution: strips trailing "(Gupy)" suffix from entry.name
// (portals.yml convention). Logs INFO per tenant which path was used.
//
// Job URL: API returns fully-constructed `j.jobUrl`; NEXT_DATA path
// reconstructs via `/job/{base64({jobId,source:"google_for_jobs"})}`.

const API_BASE = 'https://employability-portal.gupy.io/api/v1/jobs';
const API_PAGE_LIMIT = 100;
const API_TIMEOUT_MS = 15000;
const GUPY_HOST_REGEX = /^https?:\/\/([\w-]+)\.gupy\.io(?:\/|$)/i;
const GUPY_HOST_SUFFIX = '.gupy.io';
const REQUEST_TIMEOUT_MS = 15000;
const NEXT_DATA_REGEX = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/i;
const GUPY_NAME_SUFFIX_RE = /\s*\(\s*gupy\s*\)\s*$/i;

/**
 * @param {string} careersUrl
 * @returns {{tenant: string, origin: string}|null}
 */
function resolveTenant(careersUrl) {
  if (typeof careersUrl !== 'string') return null;
  const m = careersUrl.match(GUPY_HOST_REGEX);
  if (!m) return null;
  return { tenant: m[1], origin: `https://${m[1]}.gupy.io` };
}

/**
 * Strip the "(Gupy)" suffix that portals.yml entry names carry.
 * "Brainfarma (Gupy)" → "Brainfarma".
 *
 * @param {string} name
 * @returns {string}
 */
function stripGupySuffix(name) {
  return String(name || '').replace(GUPY_NAME_SUFFIX_RE, '').trim();
}

/**
 * Construct the Gupy job URL the same way the SSR sitemap does.
 *
 * @param {number|string} jobId
 * @returns {string} base64 of {jobId, source: 'google_for_jobs'}
 */
function encodeJobHash(jobId) {
  const payload = JSON.stringify({ jobId: Number(jobId) || jobId, source: 'google_for_jobs' });
  return Buffer.from(payload, 'utf8').toString('base64');
}

/**
 * Format Gupy workplace location into a single human-readable string.
 *
 * @param {object} workplace — { address: {country,state,city,district}, workplaceType }
 * @returns {string}
 */
function formatLocation(workplace) {
  if (!workplace || typeof workplace !== 'object') return '';
  const addr = workplace.address || {};
  const parts = [addr.city, addr.state, addr.country].filter((p) => p && String(p).trim());
  const base = parts.join(', ');
  const wpType = (workplace.workplaceType || '').toLowerCase();
  if (wpType === 'remote') return base ? `Remote — ${base}` : 'Remote';
  if (wpType === 'hybrid') return base ? `Hybrid — ${base}` : 'Hybrid';
  return base;
}

/**
 * Format API job location (flat city/state/country fields).
 *
 * @param {{city?:string,state?:string,country?:string,workplaceType?:string}} j
 * @returns {string}
 */
function formatApiLocation(j) {
  const parts = [j?.city, j?.state, j?.country].filter((p) => p && String(p).trim());
  const base = parts.join(', ');
  const wpType = (j?.workplaceType || '').toLowerCase();
  if (wpType === 'remote') return base ? `Remote — ${base}` : 'Remote';
  if (wpType === 'hybrid') return base ? `Hybrid — ${base}` : 'Hybrid';
  return base;
}

/**
 * Paginated fetch of the central Gupy API for one tenant.
 * Returns the raw items array (description stripped) on success, or null on
 * any error / 0 hits so caller can fall back to NEXT_DATA.
 *
 * @param {string} careerPageName — exact-match, case-sensitive
 * @param {Context} ctx
 * @returns {Promise<Array<object>|null>}
 */
async function fetchGupyJobsViaAPI(careerPageName, ctx) {
  if (!careerPageName) return null;
  /** @type {Array<object>} */
  const items = [];
  let offset = 0;
  let total = Infinity;
  // Hard cap to avoid runaway loops on a misbehaving API
  const MAX_OFFSET = 10_000;
  while (offset < total && offset < MAX_OFFSET) {
    const url = `${API_BASE}?careerPageName=${encodeURIComponent(careerPageName)}&limit=${API_PAGE_LIMIT}&offset=${offset}`;
    let payload;
    try {
      payload = await ctx.fetchJson(url, {
        timeoutMs: API_TIMEOUT_MS,
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      process.stderr.write(`[gupy] api error tenant="${careerPageName}" offset=${offset}: ${err?.message || err}\n`);
      return null;
    }
    const page = (payload && /** @type {any} */(payload).data) || [];
    const pagination = (payload && /** @type {any} */(payload).pagination) || {};
    total = Number(pagination.total ?? page.length);
    if (!page.length) break;
    for (const j of page) {
      if (j && typeof j === 'object') {
        // Strip description field — 3-5K chars per job; runtime-only.
        // eslint-disable-next-line no-unused-vars
        const { description, ...rest } = /** @type {any} */(j);
        items.push(rest);
      }
    }
    offset += page.length;
    if (page.length < API_PAGE_LIMIT) break;
  }
  if (!items.length) return null;
  return items;
}

/**
 * Map a single API item to the canonical Job shape (v2.1).
 *
 * @param {any} j
 * @param {string} company
 * @returns {Job|null}
 */
function mapApiItemToJob(j, company) {
  const title = String(j?.name || '').trim();
  if (!title) return null;
  if (!j?.id) return null;
  const url = String(j?.jobUrl || '').trim();
  if (!url) return null;

  const work_mode = workModeFromEnum(j?.workplaceType || '');
  const locForBR = {
    city: j?.city || '',
    region: j?.state || '',
    country: j?.country || 'Brazil', // Gupy tenants are BR-hosted
    fullLocation: '',
  };
  const br_eligible = brEligibleFromStructuredLocation(locForBR, work_mode);
  const locationFmt = formatApiLocation(j);
  // v2.1: API exposes `type` with same `vacancy_type_*` prefix as NEXT_DATA
  // (vacancy_type_effective/intern/trainee/temporary). Strip then map.
  const rawType = String(j?.type || '').replace(/^vacancy_type_/i, '');
  const employment_type = employmentTypeFromEnum(rawType);
  const posted_at = truncateDateISO(j?.publishedDate || '');

  /** @type {Job} */
  const job = {
    title,
    url,
    company,
    location: locationFmt,
    work_mode,
    br_eligible,
    location_real: locationFmt,
  };
  if (employment_type) job.employment_type = employment_type;
  if (posted_at) job.posted_at = posted_at;
  return job;
}

/**
 * @param {PortalEntry & { search_text?: string, remote_only?: boolean }} entry
 */
function detect(entry) {
  const resolved = resolveTenant(entry?.careers_url || entry?.url || '');
  if (!resolved) return null;
  return { url: resolved.origin };
}

/**
 * @param {PortalEntry & { search_text?: string, remote_only?: boolean }} entry
 * @param {Context} ctx
 * @returns {Promise<Job[]>}
 */
async function fetch(entry, ctx) {
  const resolved = resolveTenant(entry?.careers_url || entry?.url || '');
  if (!resolved) {
    throw new Error('gupy: entry does not match Gupy URL pattern');
  }
  const { tenant, origin } = resolved;
  const company = String(entry?.name || tenant);

  const searchText = (entry?.search_text || '').trim().toLowerCase();
  const titleFilter = searchText
    ? (/** @type {string} */ title) => title.toLowerCase().includes(searchText)
    : () => true;
  const remoteOnly = !!entry?.remote_only;

  // PATH A: Central API via careerPageName exact match.
  const careerPageName = stripGupySuffix(entry?.name || '');
  if (careerPageName) {
    const apiItems = await fetchGupyJobsViaAPI(careerPageName, ctx);
    if (apiItems && apiItems.length) {
      /** @type {Job[]} */
      const out = [];
      for (const j of apiItems) {
        const title = String(j?.name || '').trim();
        if (!title) continue;
        if (!titleFilter(title)) continue;
        const wpType = String(j?.workplaceType || '').toLowerCase();
        if (remoteOnly && wpType !== 'remote') continue;
        const job = mapApiItemToJob(j, company);
        if (job) out.push(job);
      }
      process.stderr.write(`[gupy] tenant="${careerPageName}" path=api items=${apiItems.length} mapped=${out.length}\n`);
      return out;
    }
  }

  // PATH B: NEXT_DATA SSR fallback (tenant not indexed by central API).
  const html = await ctx.fetchText(origin, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });

  const m = html.match(NEXT_DATA_REGEX);
  if (!m) {
    throw new Error(`gupy: __NEXT_DATA__ not found on ${origin}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`gupy: __NEXT_DATA__ parse error: ${err?.message || err}`);
  }

  const jobs = parsed?.props?.pageProps?.jobs;
  if (!Array.isArray(jobs)) {
    process.stderr.write(`[gupy] tenant="${careerPageName || tenant}" path=next-data items=0 (no jobs array)\n`);
    return [];
  }

  /** @type {Job[]} */
  const out = [];
  for (const j of jobs) {
    const title = String(j?.title || '').trim();
    if (!title) continue;
    if (!titleFilter(title)) continue;
    const wpType = (j?.workplace?.workplaceType || '').toLowerCase();
    if (remoteOnly && wpType !== 'remote') continue;

    const id = j?.id;
    if (!id) continue;

    const hash = encodeJobHash(id);
    const url = `${origin}/job/${hash}?jobBoardSource=google_for_jobs`;
    const work_mode = workModeFromEnum(j?.workplace?.workplaceType || '');
    // Build a structured loc obj for brEligibleFromStructuredLocation
    const addr = j?.workplace?.address || {};
    const locForBR = {
      city: addr.city || '',
      region: addr.state || '',
      country: addr.country || 'Brazil', // Gupy tenants are BR-hosted
      fullLocation: '',
    };
    const br_eligible = brEligibleFromStructuredLocation(locForBR, work_mode);
    const locationFmt = formatLocation(j?.workplace);
    // v2.1: Gupy NEXT_DATA expõe `type` com prefixo `vacancy_type_`
    // (vacancy_type_effective/intern/trainee/temporary). publishedDate NÃO
    // está exposto no payload SSR atual (recon COTSK-7 23/may). Sem
    // compensation/apply_url. Strip prefix antes do enum mapper.
    const rawType = String(j?.type || '').replace(/^vacancy_type_/i, '');
    const employment_type = employmentTypeFromEnum(rawType);
    // posted_at deferred — Gupy NEXT_DATA não expõe (probe COTSK-7 confirmou
    // job keys = {id, title, type, department, workplace, quickApply} apenas).
    const posted_at = undefined;
    /** @type {Job} */
    const job = {
      title,
      url,
      company,
      location: locationFmt,
      work_mode,
      br_eligible,
      location_real: locationFmt,
    };
    if (employment_type) job.employment_type = employment_type;
    if (posted_at) job.posted_at = posted_at;
    out.push(job);
  }
  process.stderr.write(`[gupy] tenant="${careerPageName || tenant}" path=next-data items=${jobs.length} mapped=${out.length}\n`);
  return out;
}

/**
 * verifySlug — quick HEAD/GET against tenant root.
 *
 * @param {string} slug e.g. 'eurofarma'
 * @returns {Promise<{ok: boolean, status?: number, hasJobs?: boolean, jobCount?: number, reason?: string}>}
 */
export async function verifySlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    return { ok: false, reason: 'slug must be a non-empty string' };
  }
  const url = `https://${slug.trim()}${GUPY_HOST_SUFFIX}`;
  let res;
  try {
    res = await globalThis.fetch(url, {
      headers: { 'User-Agent': 'career-ops-verify/1.0' },
    });
  } catch (err) {
    return { ok: false, reason: `fetch error: ${err?.message || err}` };
  }
  if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };

  const html = await res.text();
  const m = html.match(NEXT_DATA_REGEX);
  if (!m) return { ok: true, status: res.status, hasJobs: false, reason: '__NEXT_DATA__ missing' };
  try {
    const parsed = JSON.parse(m[1]);
    const jobs = parsed?.props?.pageProps?.jobs;
    return {
      ok: true,
      status: res.status,
      hasJobs: Array.isArray(jobs),
      jobCount: Array.isArray(jobs) ? jobs.length : 0,
    };
  } catch {
    return { ok: true, status: res.status, hasJobs: false, reason: '__NEXT_DATA__ parse error' };
  }
}

/** @type {Provider} */
const provider = { id: 'gupy', detect, fetch };

export default provider;
