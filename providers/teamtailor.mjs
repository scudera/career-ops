// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Teamtailor provider — fetches jobs from the JSON Feed v1.1 endpoint.
//
// Teamtailor exposes a public feed at https://{slug}.teamtailor.com/jobs.json
// Each item has: id, title, url, date_published, content_html, _jobposting.
// Location is embedded in _jobposting.jobLocation[0].address (Schema.org PostalAddress).
// No explicit work_mode signal at list level → UNKNOWN.

const REQUEST_TIMEOUT_MS = 15_000;
const TEAMTAILOR_HOST_PATTERN = /^([a-z0-9-]+)\.teamtailor\.com$/i;

/**
 * Extract the Teamtailor slug from a careers URL.
 * Accepts both "https://slug.teamtailor.com" and "https://slug.teamtailor.com/jobs".
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractSlug(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = TEAMTAILOR_HOST_PATTERN.exec(parsed.hostname);
  return match ? match[1] : null;
}

/**
 * Extract a best-effort location label from a JSON Feed item's _jobposting.
 * Schema.org jobLocation → Place → PostalAddress → addressLocality, addressCountry.
 *
 * @param {any} item
 * @returns {string}
 */
export function extractLocation(item) {
  try {
    const jobposting = item?._jobposting;
    if (!jobposting) return '';
    const locations = jobposting.jobLocation;
    if (!locations) return '';
    const first = Array.isArray(locations) ? locations[0] : locations;
    if (!first) return '';
    const addr = first?.address;
    if (!addr) return '';
    const parts = [addr.addressLocality, addr.addressCountry].filter(Boolean);
    return parts.join(', ');
  } catch {
    return '';
  }
}

/**
 * Map a raw JSON Feed item to the v1 Job schema.
 * Exported for unit testing.
 *
 * @param {any} item
 * @param {string} companyName
 * @returns {Job|null}
 */
export function mapItem(item, companyName) {
  const title = String(item?.title || '').trim();
  const url = String(item?.url || '').trim();
  if (!title || !url) return null;

  /** @type {Job} */
  const job = {
    title,
    url,
    company: companyName,
    location: extractLocation(item),
  };

  // posted_at: date_published is ISO 8601 — truncate to YYYY-MM-DD
  if (item?.date_published) {
    const truncated = String(item.date_published).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(truncated)) {
      job.posted_at = truncated;
    }
  }

  return job;
}

/** @type {Provider} */
export default {
  id: 'teamtailor',

  /**
   * Detect a Teamtailor entry by hostname pattern.
   * Returns { url } pointing at the JSON Feed endpoint, or null.
   *
   * @param {PortalEntry} entry
   */
  detect(entry) {
    const slug = extractSlug(entry?.careers_url || '');
    if (!slug) return null;
    return { url: `https://${slug}.teamtailor.com/jobs.json` };
  },

  /**
   * Fetch all jobs from the Teamtailor JSON Feed.
   * Teamtailor returns all published jobs in a single response (no server-side pagination
   * observed in practice), but the JSON Feed 1.1 spec supports `next_url` — we follow
   * it defensively if present, capping at MAX_PAGES to avoid infinite loops.
   *
   * @param {PortalEntry} entry
   * @param {Context} ctx
   * @returns {Promise<Job[]>}
   */
  async fetch(entry, ctx) {
    const slug = extractSlug(entry?.careers_url || '');
    if (!slug) throw new Error(`teamtailor: cannot derive slug from careers_url: ${entry?.careers_url}`);

    const firstUrl = `https://${slug}.teamtailor.com/jobs.json`;
    /** @type {Job[]} */
    const jobs = [];
    let nextUrl = firstUrl;
    let pageCount = 0;
    const MAX_PAGES = 20;
    let companyName = entry?.name || slug;
    let totalItems = 0;

    while (nextUrl && pageCount < MAX_PAGES) {
      const data = await ctx.fetchJson(nextUrl, { timeoutMs: REQUEST_TIMEOUT_MS, redirect: 'error' });
      pageCount++;

      // Resolve company name from first page feed title if not set by entry
      if (pageCount === 1 && !entry?.name) {
        companyName = String(data?.title || '').trim() || slug;
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      totalItems += items.length;
      for (const item of items) {
        const job = mapItem(item, companyName);
        if (job) jobs.push(job);
      }

      // JSON Feed 1.1 pagination: follow next_url if present, pinned to the same
      // teamtailor.com host (SSRF guard — combined with redirect:'error' above).
      const rawNext = typeof data?.next_url === 'string' && data.next_url ? data.next_url : null;
      if (rawNext) {
        try {
          nextUrl = new URL(rawNext).hostname.endsWith('.teamtailor.com') ? rawNext : null;
        } catch {
          nextUrl = null;
        }
      } else {
        nextUrl = null;
      }
    }

    process.stderr.write(
      `[teamtailor] slug="${slug}" pages=${pageCount} items=${totalItems} mapped=${jobs.length}\n`
    );
    return jobs;
  },
};
