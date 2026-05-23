// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */
/** @typedef {import('./_types.js').WorkMode} WorkMode */
/** @typedef {import('./_types.js').BrEligible} BrEligible */

// Workday provider — hits the public CXS jobs endpoint via POST.
// Auto-detects from careers_url pattern `https://{tenant}.{shard}.myworkdayjobs.com/{site}`.
//
// Schema v2 (CP2 22/may/26): infers work_mode + br_eligible from
// `posting.locationsText` heuristics. Workday CXS doesn't expose a remote/
// hybrid enum at the list level, so signal comes from the location string
// itself (e.g. "USA-Remote", "São Paulo, Brazil"). Ambiguous strings →
// UNKNOWN; pre-apply-check enrich resolves them downstream.

const BR_LOC_HINT = /\b(brasil|brazil|^br$|s[aã]o\s*paulo|rio\s*de\s*janeiro|campinas|jarinu|barueri|guarulhos)\b/i;
const REMOTE_LOC_HINT = /\b(remote|remoto|home[\s-]?based|teletrabalho)\b/i;
const HYBRID_LOC_HINT = /\bhybrid|h[ií]brido\b/i;

/**
 * @param {string} locationsText
 * @returns {{work_mode: WorkMode, br_eligible: BrEligible}}
 */
function inferModeFromLocation(locationsText) {
  const lt = (locationsText || '').trim();
  if (!lt) return { work_mode: 'UNKNOWN', br_eligible: 'UNKNOWN' };
  const isBR = BR_LOC_HINT.test(lt);
  const isRemote = REMOTE_LOC_HINT.test(lt);
  const isHybrid = HYBRID_LOC_HINT.test(lt);
  /** @type {WorkMode} */
  let work_mode = 'UNKNOWN';
  if (isHybrid) work_mode = 'HYBRID';
  else if (isRemote) work_mode = 'REMOTE';
  // ON_SITE inferred only when location is concrete city (not "remote"/"hybrid")
  // and no remote/hybrid signal — but locationsText alone doesn't confirm on-site
  // unambiguously, so leave UNKNOWN unless explicit.
  /** @type {BrEligible} */
  let br_eligible = 'UNKNOWN';
  if (work_mode === 'REMOTE') {
    if (isBR) br_eligible = 'BR_OK';
    else if (lt) br_eligible = 'RELOCATION_REQUIRED'; // remote but non-BR country named
  } else {
    if (isBR) br_eligible = 'BR_OK';
    // Non-BR concrete city → RELOCATION (but we don't know if it's on-site;
    // mark as RELOCATION if a non-BR country appears, conservative).
    else if (lt && !isRemote && !isHybrid) br_eligible = 'RELOCATION_REQUIRED';
  }
  return { work_mode, br_eligible };
}

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

/**
 * verifySlug — sanity check de tenant+site combination via single POST CXS limit=1.
 *
 * Cherry-picked de LeoLaborie/claude-apply (MIT) src/scan/ats/workday.mjs::verifySlug.
 * Substitui Playwright network-capture (~3min/site) por sync HTTP (~2s) para
 * descoberta de Workday Site ID correto.
 *
 * @param {string} tenantUrl - URL base do Workday (https://{tenant}.{shard}.myworkdayjobs.com/{site})
 * @returns {Promise<{ok: boolean, count?: number, status?: number, reason?: string}>}
 */
export async function verifySlug(tenantUrl) {
  if (typeof tenantUrl !== 'string') {
    return { ok: false, reason: 'tenantUrl must be a string' };
  }
  const m = tenantUrl.match(WORKDAY_HOST_REGEX);
  if (!m) {
    return { ok: false, reason: `not a Workday URL: ${tenantUrl}` };
  }
  const [, tenant, shard, site] = m;
  const endpoint = `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  try {
    assertWorkdayUrl(endpoint);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  let res;
  try {
    res = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'career-ops-verify/1.0',
      },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
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
  const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
  const count = typeof data?.total === 'number' ? data.total : postings.length;
  return { ok: true, count };
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
        const locationsText = String(posting.locationsText || '');
        const inferred = inferModeFromLocation(locationsText);
        jobs.push({
          title: String(posting.title),
          url: baseDisplay + String(posting.externalPath),
          company,
          location: locationsText,
          work_mode: inferred.work_mode,
          br_eligible: inferred.br_eligible,
          location_real: locationsText, // best-effort canonical; CXS doesn't expose richer structure
        });
      }

      const total = typeof data.total === 'number' ? data.total : null;
      offset += PAGE_SIZE;
      if (total != null && offset >= total) break;
    }

    return jobs;
  },
};
