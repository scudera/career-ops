// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Workable provider — hits the public widget endpoint.
// Endpoint: GET https://apply.workable.com/api/v1/widget/accounts/{slug}
// Adapted from LeoLaborie/claude-apply (MIT) src/scan/ats/workable.mjs.
//
// Schema v2 (CP2 22/may/26): Workable widget JSON exposes `telecommuting`
// boolean + `workplace` string (when present). Mapped via
// classify-work-mode::workModeFromEnum + brEligibleFromStructuredLocation.

import {
  workModeFromEnum,
  brEligibleFromStructuredLocation,
  employmentTypeFromEnum,
  truncateDateISO,
  asAbsoluteUrl,
  compensationPeriodFromEnum,
} from '../classify-work-mode.mjs';

const WORKABLE_HOST = 'apply.workable.com';
const WORKABLE_API_BASE = `https://${WORKABLE_HOST}/api/v1/widget/accounts`;
const WORKABLE_URL_REGEX = /^https:\/\/apply\.workable\.com\/([\w-]+)(?:\/|\?|#|$)/;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * @param {PortalEntry & { slug?: string }} entry
 */
function resolveSlug(entry) {
  if (entry?.slug && typeof entry.slug === 'string' && entry.slug.trim()) {
    return entry.slug.trim();
  }
  const url = entry?.careers_url;
  if (typeof url !== 'string') return null;
  const m = url.match(WORKABLE_URL_REGEX);
  return m ? m[1] : null;
}

function formatLocation(job) {
  const parts = [job?.city, job?.country].filter((p) => p && String(p).trim());
  const base = parts.join(', ');
  if (job?.telecommuting === true) {
    return base ? `Remote — ${base}` : 'Remote';
  }
  return base;
}

/** @type {Provider} */
const provider = {
  id: 'workable',

  detect(entry) {
    const slug = resolveSlug(entry);
    if (!slug) return null;
    return { url: `${WORKABLE_API_BASE}/${slug}` };
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`workable: cannot derive slug for ${entry?.name || 'entry'}`);

    const url = `${WORKABLE_API_BASE}/${slug}`;
    const data = await ctx.fetchJson(url, {
      headers: { Accept: 'application/json' },
      timeoutMs: REQUEST_TIMEOUT_MS,
      redirect: 'error',
    });

    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const company = String(entry?.name || data?.name || slug);

    return jobs
      .filter((j) => j?.title && (j?.shortlink || j?.url))
      .map((j) => {
        // Workable: prefer explicit `workplace` enum, fall back to telecommuting bool
        let work_mode = workModeFromEnum(j?.workplace || '');
        if (work_mode === 'UNKNOWN' && j?.telecommuting === true) work_mode = 'REMOTE';
        const loc = { city: j?.city || '', region: j?.region || '', country: j?.country || '', fullLocation: '' };
        const br_eligible = brEligibleFromStructuredLocation(loc, work_mode);
        const locationFmt = formatLocation(j);
        const url = String(j.shortlink || j.url);
        // v2.1: Workable API expõe j.employment_type, j.published_on (ISO),
        // j.salary {min, max, currency, period}, j.application_url. Todos
        // opcionais; alguns tenants não preenchem salary/application_url.
        const employment_type = employmentTypeFromEnum(j?.employment_type || '');
        const posted_at = j?.published_on ? truncateDateISO(String(j.published_on)) : undefined;
        const sal = j?.salary || {};
        const compensation_min = Number.isFinite(sal.min) ? sal.min : undefined;
        const compensation_max = Number.isFinite(sal.max) ? sal.max : undefined;
        const compensation_currency = typeof sal.currency === 'string' && sal.currency.trim() ? sal.currency.trim().toUpperCase() : undefined;
        const compensation_period = compensationPeriodFromEnum(sal.period || sal.unit || '');
        const apply_candidate = j?.application_url || j?.apply_url;
        const apply_url = (apply_candidate && apply_candidate !== url) ? asAbsoluteUrl(String(apply_candidate)) : undefined;
        /** @type {Job} */
        const job = {
          title: String(j.title),
          url,
          company,
          location: locationFmt,
          work_mode,
          br_eligible,
          location_real: locationFmt,
        };
        if (employment_type) job.employment_type = employment_type;
        if (compensation_min !== undefined) job.compensation_min = compensation_min;
        if (compensation_max !== undefined) job.compensation_max = compensation_max;
        if (compensation_currency) job.compensation_currency = compensation_currency;
        if (compensation_period) job.compensation_period = compensation_period;
        if (posted_at) job.posted_at = posted_at;
        if (apply_url) job.apply_url = apply_url;
        return job;
      });
  },
};

/**
 * verifySlug — sanity check Workable slug via single GET.
 *
 * Adapted from LeoLaborie/claude-apply (MIT). Mirrors workday.mjs::verifySlug
 * shape. Useful for discovery before adding a new entry to portals.yml.
 *
 * @param {string} slug
 * @returns {Promise<{ok: boolean, count?: number, status?: number, reason?: string}>}
 */
export async function verifySlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    return { ok: false, reason: 'slug must be a non-empty string' };
  }
  const url = `${WORKABLE_API_BASE}/${slug.trim()}`;
  let res;
  try {
    res = await globalThis.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'career-ops-verify/1.0',
      },
      redirect: 'error',
    });
  } catch (err) {
    return { ok: false, reason: `fetch error: ${err?.message || err}` };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, reason: `json parse error: ${err?.message || err}` };
  }
  const count = Array.isArray(data?.jobs) ? data.jobs.length : 0;
  return { ok: true, count };
}

export default provider;
