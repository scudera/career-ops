// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// SmartRecruiters provider.
//
// Public REST API, no auth required:
//   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings
//        ?offset={N}&limit={M}
//
// Pagination: response carries `totalFound`, `offset`, `limit`, `content[]`.
// Job-page URL pattern: https://jobs.smartrecruiters.com/{slug}/{postingId}.
//
// Coverage in current portals.yml is low/none; provider added so new
// SR-hosted tenants discovered later can be wired with one entry.
//
// Schema v2 (CP2 22/may/26): SR posting object exposes `location.remote`
// and `location.hybrid` booleans (already used by formatLocation). Mapping
// to canonical WorkMode:
//   - location.remote === true  → REMOTE
//   - location.hybrid === true  → HYBRID
//   - both false                → ON_SITE (assumed by SR convention)
// br_eligible inferred from location.country (Brazil → BR_OK, else
// RELOCATION_REQUIRED for ON_SITE/HYBRID, UNKNOWN-friendly for REMOTE).
// Standby — no portals.yml entries today; method documented for activation.

import {
  brEligibleFromStructuredLocation,
  employmentTypeFromEnum,
  truncateDateISO,
} from '../classify-work-mode.mjs';

const SR_API_BASE = 'https://api.smartrecruiters.com/v1/companies';
const SR_JOBS_BASE = 'https://jobs.smartrecruiters.com';
const SR_URL_REGEX = /^https:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/;
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_LIMIT = 100;
const MAX_OFFSET = 1000;

/**
 * @param {PortalEntry & { slug?: string }} entry
 */
function resolveSlug(entry) {
  if (entry?.slug && typeof entry.slug === 'string' && entry.slug.trim()) {
    return entry.slug.trim();
  }
  const url = entry?.careers_url;
  if (typeof url !== 'string') return null;
  const m = url.match(SR_URL_REGEX);
  return m ? m[1] : null;
}

/**
 * @param {object} loc — { city, region, country, fullLocation, remote, hybrid }
 */
function formatLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const full = (loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ')).trim();
  if (loc.remote === true) return full ? `Remote — ${full}` : 'Remote';
  if (loc.hybrid === true) return full ? `Hybrid — ${full}` : 'Hybrid';
  return full;
}

/**
 * @param {PortalEntry & { slug?: string }} entry
 */
function detect(entry) {
  const slug = resolveSlug(entry);
  if (!slug) return null;
  return { url: `${SR_API_BASE}/${slug}/postings` };
}

/**
 * @param {PortalEntry & { slug?: string, search_text?: string, remote_only?: boolean }} entry
 * @param {Context} ctx
 * @returns {Promise<Job[]>}
 */
async function fetch(entry, ctx) {
  const slug = resolveSlug(entry);
  if (!slug) throw new Error(`smartrecruiters: cannot derive slug for ${entry?.name || 'entry'}`);

  const company = String(entry?.name || slug);
  const searchText = (entry?.search_text || '').trim();
  const remoteOnly = !!entry?.remote_only;

  /** @type {Job[]} */
  const out = [];
  let offset = 0;

  while (offset <= MAX_OFFSET) {
    const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE_LIMIT) });
    if (searchText) qs.set('q', searchText);
    const url = `${SR_API_BASE}/${slug}/postings?${qs.toString()}`;

    /** @type {any} */
    let data;
    try {
      data = await ctx.fetchJson(url, {
        headers: { Accept: 'application/json' },
        timeoutMs: REQUEST_TIMEOUT_MS,
        redirect: 'error',
      });
    } catch (err) {
      const msg = String(err?.message || err);
      if (/HTTP (429|503|502|504)/.test(msg)) break;
      throw err;
    }

    const items = Array.isArray(data?.content) ? data.content : [];
    if (items.length === 0) break;

    for (const j of items) {
      const title = String(j?.name || '').trim();
      const id = j?.id;
      if (!title || !id) continue;
      if (remoteOnly && j?.location?.remote !== true) continue;
      const loc = j?.location || {};
      /** @type {'REMOTE'|'HYBRID'|'ON_SITE'|'UNKNOWN'} */
      let work_mode = 'UNKNOWN';
      if (loc.remote === true) work_mode = 'REMOTE';
      else if (loc.hybrid === true) work_mode = 'HYBRID';
      else if (loc.city || loc.country) work_mode = 'ON_SITE';
      const br_eligible = brEligibleFromStructuredLocation(
        { city: loc.city, region: loc.region, country: loc.country, fullLocation: loc.fullLocation },
        work_mode,
      );
      const locationFmt = formatLocation(loc);
      // v2.1: SmartRec API expõe j.typeOfEmployment.id (full-time/part-time/etc)
      // e j.releasedDate (ISO). Compensation + apply_url raramente preenchidos
      // no plano free do SmartRec API; deixar undefined quando ausente.
      const employment_type = employmentTypeFromEnum(j?.typeOfEmployment?.id || j?.typeOfEmployment?.label || '');
      const posted_at = j?.releasedDate ? truncateDateISO(String(j.releasedDate)) : undefined;
      /** @type {Job} */
      const jobOut = {
        title,
        url: `${SR_JOBS_BASE}/${slug}/${id}`,
        company,
        location: locationFmt,
        work_mode,
        br_eligible,
        location_real: locationFmt,
      };
      if (employment_type) jobOut.employment_type = employment_type;
      if (posted_at) jobOut.posted_at = posted_at;
      out.push(jobOut);
    }

    offset += items.length;
    if (items.length < PAGE_LIMIT) break;
  }

  return out;
}

/**
 * verifySlug — confirms slug exists + returns posting count.
 *
 * @param {string} slug
 * @returns {Promise<{ok: boolean, count?: number, status?: number, reason?: string}>}
 */
export async function verifySlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    return { ok: false, reason: 'slug must be a non-empty string' };
  }
  const url = `${SR_API_BASE}/${slug.trim()}/postings?limit=1`;
  let res;
  try {
    res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'career-ops-verify/1.0' },
    });
  } catch (err) {
    return { ok: false, reason: `fetch error: ${err?.message || err}` };
  }
  if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  /** @type {any} */
  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, reason: `json parse error: ${err?.message || err}` };
  }
  const count = typeof data?.totalFound === 'number'
    ? data.totalFound
    : (Array.isArray(data?.content) ? data.content.length : 0);
  return { ok: true, count, status: res.status };
}

/** @type {Provider} */
const provider = { id: 'smartrecruiters', detect, fetch };

export default provider;
