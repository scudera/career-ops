// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Phenom ATS provider — sitemap-based discovery.
//
// Phenom's job-listing widget API is session-bound (POST /widgets with a
// session-authenticated JWT token). Reverse-engineering it would couple us
// to internal API churn. The sitemap.xml is the stable public surface
// Phenom maintains for SEO — it lists every active job URL with the title
// embedded in the slug, indexed daily.
//
// Strategy:
//   1. GET {origin}/sitemap.xml → sitemap index with sub-sitemap URLs.
//   2. For each sub-sitemap, GET → extract <loc> entries with /job/ path.
//   3. Parse slug pattern `/job/{JOB_ID}/{Title-With-Hyphens}` → title.
//   4. Optional: filter by entry.search_text regex (case-insensitive).
//
// Confirmed Phenom pharma tenants (HTML signature `phenompeople.com`):
//   - Thermo Fisher (jobs.thermofisher.com, refNum=TFSCGLOBAL)
//   - MSD/Merck (jobs.merck.com, refNum=MERCUS)
//
// AbbVie/J&J/Bayer/BMS — NOT Phenom despite prompt assumption; they use
// other ATSes (Avature, Eightfold, WordPress, etc).

const PHENOM_HOST_REGEX = /^https?:\/\/(jobs\.thermofisher\.com|jobs\.merck\.com)(?:\/|$)/i;
const SITEMAP_TIMEOUT_MS = 20000;
const MAX_SUB_SITEMAPS = 10;

/**
 * Convert a Phenom job-slug URL to a clean title.
 *
 *   /global/en/job/R-01342539/Sr-Systems-Analyst
 *     → "Sr Systems Analyst"
 *
 * @param {string} url
 * @returns {{title: string, jobId: string}|null}
 */
function parseJobUrl(url) {
  // path segment after /job/ — first is ID, rest is title-slug
  const m = url.match(/\/job\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const jobId = decodeURIComponent(m[1]);
  let title = decodeURIComponent(m[2]).replace(/-/g, ' ').trim();
  // Collapse repeated whitespace and strip trailing punctuation artifacts
  title = title.replace(/\s+/g, ' ');
  return { title, jobId };
}

/**
 * Extract <loc> entries from sitemap XML without a full XML parser.
 * Sitemaps are flat XML with regular structure — regex is safe here.
 *
 * @param {string} xml
 * @returns {string[]}
 */
function extractLocs(xml) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * @param {PortalEntry & { sitemap_url?: string, search_text?: string }} entry
 */
function detect(entry) {
  const url = entry?.careers_url || '';
  if (typeof url !== 'string') return null;
  const m = url.match(PHENOM_HOST_REGEX);
  if (!m) return null;
  return { url: `https://${m[1]}/sitemap.xml` };
}

/**
 * @param {PortalEntry & { sitemap_url?: string, search_text?: string }} entry
 * @param {Context} ctx
 * @returns {Promise<Job[]>}
 */
async function fetch(entry, ctx) {
  const careersUrl = entry?.careers_url || '';
  if (typeof careersUrl !== 'string' || !careersUrl) {
    throw new Error('phenom: entry.careers_url required');
  }
  const m = careersUrl.match(PHENOM_HOST_REGEX);
  if (!m) {
    throw new Error(`phenom: not a Phenom URL: ${careersUrl}`);
  }
  const host = m[1];
  const origin = `https://${host}`;
  const company = String(entry?.name || host);

  // search_text filter — case-insensitive substring match against title.
  // If absent, return all jobs (caller may post-filter via roster/keywords).
  const searchText = (entry?.search_text || '').trim().toLowerCase();
  const filter = searchText
    ? (title) => title.toLowerCase().includes(searchText)
    : () => true;

  // 1. Fetch sitemap index
  const indexXml = await ctx.fetchText(`${origin}/sitemap.xml`, {
    timeoutMs: SITEMAP_TIMEOUT_MS,
    headers: { Accept: 'application/xml,text/xml' },
  });

  const subSitemaps = extractLocs(indexXml).filter((u) => /sitemap\d*\.xml/i.test(u));
  if (subSitemaps.length === 0) {
    // Some tenants serve a flat sitemap (no index) — treat indexXml as the
    // listing itself.
    return extractFromXml(indexXml, host, company, filter);
  }

  /** @type {Job[]} */
  const jobs = [];
  const seen = new Set();

  for (const subUrl of subSitemaps.slice(0, MAX_SUB_SITEMAPS)) {
    let subXml;
    try {
      subXml = await ctx.fetchText(subUrl, {
        timeoutMs: SITEMAP_TIMEOUT_MS,
        headers: { Accept: 'application/xml,text/xml' },
      });
    } catch (err) {
      // Skip a broken sub-sitemap rather than abort the whole tenant.
      continue;
    }
    const subJobs = extractFromXml(subXml, host, company, filter);
    for (const j of subJobs) {
      if (seen.has(j.url)) continue;
      seen.add(j.url);
      jobs.push(j);
    }
  }

  return jobs;
}

/**
 * @param {string} xml
 * @param {string} host
 * @param {string} company
 * @param {(title: string) => boolean} filter
 * @returns {Job[]}
 */
function extractFromXml(xml, host, company, filter) {
  /** @type {Job[]} */
  const out = [];
  for (const url of extractLocs(xml)) {
    if (!url.includes('/job/')) continue;
    const parsed = parseJobUrl(url);
    if (!parsed) continue;
    if (!filter(parsed.title)) continue;
    out.push({
      title: parsed.title,
      url,
      company,
      // Phenom sitemap doesn't expose location at this layer; downstream
      // pre-apply-check / liveness pass can scrape per-job pages if needed.
      location: '',
      // Schema v2 (CP2 22/may/26): sitemap layer has no work_mode signal.
      // Marked UNKNOWN — pre-apply-check enrich (CP3) resolves via inspect-jds
      // for entries that survive title filter. Avoids 100 blind fetches per
      // tenant (Risk #3 decision).
      work_mode: /** @type {'UNKNOWN'} */ ('UNKNOWN'),
      br_eligible: /** @type {'UNKNOWN'} */ ('UNKNOWN'),
      location_real: '',
      // v2.1 (COTSK-7): Phenom sitemap layer também não expõe
      // employment_type/compensation/posted_at/apply_url. Pre-apply-check
      // pode resolver via JSON-LD JobPosting parse na enrich step (já roda
      // classifyFromHtml na URL ACTIVE). v2.1 fields aqui = undefined.
    });
  }
  return out;
}

/**
 * verifyTenant — confirms a host is Phenom-powered + sitemap reachable.
 *
 * @param {string} hostname e.g. 'jobs.thermofisher.com'
 * @returns {Promise<{ok: boolean, refNum?: string, sitemapStatus?: number, reason?: string}>}
 */
export async function verifyTenant(hostname) {
  if (typeof hostname !== 'string' || !hostname.trim()) {
    return { ok: false, reason: 'hostname must be a non-empty string' };
  }
  let refNum;
  try {
    const homeRes = await globalThis.fetch(`https://${hostname}`, {
      headers: { 'User-Agent': 'career-ops-verify/1.0' },
    });
    if (!homeRes.ok) return { ok: false, reason: `homepage HTTP ${homeRes.status}` };
    const html = await homeRes.text();
    if (!/phenompeople\.com/i.test(html)) {
      return { ok: false, reason: 'no phenompeople.com signature in HTML' };
    }
    const refMatch = html.match(/refNum["'\s]?[=:]\s*["']?([\w-]+)/i);
    refNum = refMatch?.[1];
  } catch (err) {
    return { ok: false, reason: `homepage fetch error: ${err?.message || err}` };
  }
  let sitemapStatus;
  try {
    const sRes = await globalThis.fetch(`https://${hostname}/sitemap.xml`, {
      headers: { 'User-Agent': 'career-ops-verify/1.0' },
    });
    sitemapStatus = sRes.status;
    if (!sRes.ok) return { ok: false, refNum, sitemapStatus, reason: `sitemap HTTP ${sRes.status}` };
  } catch (err) {
    return { ok: false, refNum, reason: `sitemap fetch error: ${err?.message || err}` };
  }
  return { ok: true, refNum, sitemapStatus };
}

/** @type {Provider} */
const provider = { id: 'phenom', detect, fetch };

export default provider;
