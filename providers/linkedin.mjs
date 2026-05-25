// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// LinkedIn jobs provider — npm: linkedin-jobs-api
//
// Uses the public LinkedIn search endpoint (jobs-guest/jobs/api/seeMoreJobPostings/search)
// — NO LinkedIn login required. Bypasses the SPA renderer which makes WebFetch
// useless for LinkedIn URLs. Rate-limited at the search level (~50 calls/hour
// observed, no auth means no per-account quota).
//
// Strategy:
//   1. Each portal entry = one query (keyword + location + date range).
//   2. Multiple entries hit the same scan run → different geographies covered.
//   3. linkedin-jobs-api returns: position, company, location, date, jobUrl,
//      companyLogo, agoTime, salary (rarely populated).
//   4. Map to Job schema v2.1 (title, url, company, location, posted_at + the rest UNKNOWN).
//   5. work_mode/br_eligible deliberately UNKNOWN — resolved downstream by
//      pre-apply-check.mjs when Vitor triages individual jobs.
//
// Limitation: LinkedIn keyword search is semantic-broad. Query "regulatory
// affairs" matches unrelated postings (e.g., insurance compliance, legal
// ops). title_filter.positive/negative in portals.yml does the second-pass
// filter post-fetch. Don't expect 100% on-target hits per query.

import linkedIn from 'linkedin-jobs-api';

const PROVIDER_ID = 'linkedin';
const QUERY_TIMEOUT_MS = 30000;
const DEFAULT_LIMIT = 25;
const DEFAULT_DATE_SINCE = 'week'; // 'past month' | 'week' | '24hr'

/** @type {Provider} */
export default {
  id: PROVIDER_ID,

  /**
   * Match portal entries declaring `provider: linkedin`.
   * @param {PortalEntry} entry
   * @returns {boolean}
   */
  detect(entry) {
    return entry?.scan_method === 'provider' && entry?.provider === PROVIDER_ID;
  },

  /**
   * @param {PortalEntry} entry
   * @param {Context} _ctx
   * @returns {Promise<Job[]>}
   */
  async fetch(entry, _ctx) {
    const keyword = entry.search_text || 'regulatory affairs';
    const location = entry.location || '';
    const dateSincePosted = entry.date_since_posted || DEFAULT_DATE_SINCE;
    const limit = String(entry.limit || DEFAULT_LIMIT);

    const queryOptions = {
      keyword,
      location,
      dateSincePosted,
      limit,
    };
    // Optional filters — only set when entry explicitly requests, so default
    // entries keep wide-recall behavior.
    if (entry.remote_filter) queryOptions.remoteFilter = entry.remote_filter; // 'remote' | 'hybrid' | 'on site'
    if (entry.experience_level) queryOptions.experienceLevel = entry.experience_level;
    if (entry.job_type) queryOptions.jobType = entry.job_type;

    let response;
    try {
      response = await Promise.race([
        linkedIn.query(queryOptions),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('linkedin-jobs-api timeout')), QUERY_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      throw new Error(`linkedin query failed (kw="${keyword}" loc="${location}"): ${err.message}`);
    }

    if (!Array.isArray(response)) return [];

    return response
      .filter(r => r && typeof r.jobUrl === 'string' && r.jobUrl.length > 0)
      .map(r => /** @type {Job} */ ({
        title: (r.position || '').trim(),
        url: r.jobUrl.split('?')[0], // strip tracking query params for stable dedup key
        company: (r.company || '').trim(),
        location_real: (r.location || '').trim(),
        // v2 fields — LinkedIn search list doesn't expose these natively;
        // pre-apply-check resolves at triage time.
        work_mode: 'UNKNOWN',
        br_eligible: 'UNKNOWN',
        // v2.1 — only posted_at is reliably available from LinkedIn list view.
        posted_at: normalizeDate(r.date),
      }))
      .filter(j => j.title.length > 0);
  },
};

function normalizeDate(raw) {
  if (!raw || typeof raw !== 'string') return undefined;
  // linkedin-jobs-api returns ISO YYYY-MM-DD or 'YYYY-MM-DD HH:MM:SS'
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}
