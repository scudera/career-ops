// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Workday provider — hits the public CXS jobs endpoint via POST.
// Auto-detects from careers_url pattern `https://{tenant}.{shard}.myworkdayjobs.com/{site}`.

const WORKDAY_HOST_REGEX = /^https:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/?#]+)/;
const WORKDAY_HOST_SUFFIX = '.myworkdayjobs.com';
const DEFAULT_SEARCH_TEXT = 'Regulatory Affairs';
const PAGE_SIZE = 20;
const MAX_OFFSET = 2000;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * SSRF defense — ensures URL targets actual Workday CXS endpoint.
 * @param {string} url
 */
function assertWorkdayUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`workday: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`workday: URL must use HTTPS: ${url}`);
  if (!parsed.hostname.endsWith(WORKDAY_HOST_SUFFIX))
    throw new Error(`workday: untrusted hostname "${parsed.hostname}" — must end with ${WORKDAY_HOST_SUFFIX}`);
  return url;
}

/**
 * Parse a Workday careers URL into tenant/shard/site + derived endpoint.
 *
 * Some tenants expose a public path that differs from the internal CXS Site
 * ID (e.g. URL path `/ThermoFisher` but Site ID `External`). For those, the
 * portals.yml entry can override the parsed site via `workday_site`.
 *
 * @param {PortalEntry & { workday_site?: string }} entry
 * @returns {{ tenant: string, shard: string, site: string, endpoint: string, baseDisplay: string } | null}
 */
function resolveTenantSite(entry) {
  const careersUrl = entry?.careers_url || '';
  if (typeof careersUrl !== 'string') return null;
  const m = careersUrl.match(WORKDAY_HOST_REGEX);
  if (!m) return null;
  const [, tenant, shard, urlSite] = m;
  const site = (typeof entry?.workday_site === 'string' && entry.workday_site.trim()) || urlSite;
  const endpoint = `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const baseDisplay = `https://${tenant}.${shard}.myworkdayjobs.com/${site}`;
  return { tenant, shard, site, endpoint, baseDisplay };
}

/** @type {Provider} */
export default {
  id: 'workday',

  detect(entry) {
    try {
      const resolved = resolveTenantSite(entry);
      if (!resolved) return null;
      assertWorkdayUrl(resolved.endpoint);
      return { url: resolved.endpoint };
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const resolved = resolveTenantSite(entry);
    if (!resolved) throw new Error(`workday: cannot derive endpoint for ${entry?.name || 'entry'}`);
    assertWorkdayUrl(resolved.endpoint);

    const { endpoint, baseDisplay } = resolved;
    const searchText = String(entry?.search_text ?? DEFAULT_SEARCH_TEXT);
    const company = String(entry?.name || resolved.tenant);

    /** @type {Job[]} */
    const jobs = [];
    let offset = 0;

    while (offset <= MAX_OFFSET) {
      const payload = {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText,
      };

      let data;
      try {
        data = await ctx.fetchJson(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs: REQUEST_TIMEOUT_MS,
          redirect: 'error',
        });
      } catch (err) {
        const msg = String(err?.message || err);
        // Graceful break on rate-limit / transient — return what we have so far
        if (/HTTP (429|503)/.test(msg)) break;
        throw err;
      }

      if (!data || !Array.isArray(data.jobPostings) || data.jobPostings.length === 0) break;

      for (const posting of data.jobPostings) {
        if (!posting?.title || !posting?.externalPath) continue;
        jobs.push({
          title: String(posting.title),
          url: baseDisplay + String(posting.externalPath),
          company,
          location: String(posting.locationsText || ''),
        });
      }

      const total = typeof data.total === 'number' ? data.total : null;
      offset += PAGE_SIZE;
      if (total != null && offset >= total) break;
    }

    return jobs;
  },
};
