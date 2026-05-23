// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Gupy BR provider — Next.js __NEXT_DATA__ SSR extraction.
//
// HISTORY: April recon found portal.api.gupy.io/api/job only indexes the
// central gupy.io/vagas page (~1-2 RA jobs total — useless). Per-tenant
// /api/v1/jobs endpoints don't exist (all 404). The original plan was
// Playwright DOM scraping at ~3min/tenant.
//
// BUT: Each Gupy tenant is a Next.js SPA that SSRs the full jobs array
// (id, title, department, workplace.address, workplaceType) into the
// homepage's `<script id="__NEXT_DATA__">` payload. One HTTP GET per
// tenant → full job list in ~1-2s. No Playwright needed.
//
// Job URL construction: `/job/{base64({jobId,source:"google_for_jobs"})}`
// (the format Gupy uses for indexable Google-for-Jobs URLs).

const GUPY_HOST_REGEX = /^https?:\/\/([\w-]+)\.gupy\.io(?:\/|$)/i;
const GUPY_HOST_SUFFIX = '.gupy.io';
const REQUEST_TIMEOUT_MS = 15000;
const NEXT_DATA_REGEX = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/i;

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
    // Empty payload is acceptable (tenant exists but has no listings today).
    return [];
  }

  const searchText = (entry?.search_text || '').trim().toLowerCase();
  const titleFilter = searchText
    ? (title) => title.toLowerCase().includes(searchText)
    : () => true;
  const remoteOnly = !!entry?.remote_only;

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
    out.push({
      title,
      url,
      company,
      location: formatLocation(j?.workplace),
    });
  }
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
