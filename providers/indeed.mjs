// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

// Indeed Brazil provider — HTML scraper via br.indeed.com/jobs
//
// Indeed deprecated its public RSS endpoint (~2023-2024); /rss returns 404.
// This provider scrapes the HTML search results page, which embeds job keys
// as `data-jk` attributes on <a> links. From those keys it constructs stable
// canonical job URLs: https://br.indeed.com/viewjob?jk=<key>
//
// Strategy:
//   1. Build query URL from entry.search_text, entry.location, entry.fromage.
//   2. Fetch HTML (ctx.fetchText, 30s timeout).
//   3. Extract (title, data-jk, company, location, date) from raw HTML via
//      regex — no DOM parser needed for the minimal fields we need.
//   4. Deduplicate by jk (Indeed sometimes repeats sponsored cards).
//   5. Post-fetch: apply hard negative-keyword filter on title (Indeed's `q=`
//      does NOT honor boolean exclusions — confirmed empirically 2026-05-25).
//   6. Return Job[] per schema v2.1.
//
// What we can extract from Indeed list HTML:
//   title        — reliable (inside <span data-testid="jobTitle">)
//   company      — reliable (aria-label on the company link)
//   location     — reliable (data-testid="text-location")
//   posted_at    — best-effort (relative "há X dias"; when today → YYYY-MM-DD)
//   employment_type — occasionally present in subtitle chips
//   work_mode    — UNKNOWN (resolved downstream by pre-apply-check)
//   br_eligible  — UNKNOWN (resolved downstream)
//
// Limitation: Playwright/browser not available in this provider; static HTML
// fetch may return a CAPTCHA challenge on repeated calls. The provider returns
// [] on HTTP 403/429/CAPTCHA and logs a warning — it does NOT throw.

const PROVIDER_ID = 'indeed';
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_LIMIT = 25;
// fromage = max age in days. Indeed supports: 1, 3, 7, 14, 30
const DEFAULT_FROMAGE = 7;
// Post-fetch title filter: words that indicate Manager/Director+ seniority.
// Indeed q= boolean negation is broken — we filter here instead.
// See modes/_profile.md § Seniority Constraint.
// Matches only true management-track titles per spec (-manager -director -lead -head).
// Does NOT exclude coordenador/supervisor — those map to Specialist/Coord level in BR pharma
// and are exactly Vitor's target range (last role: Regulatory Coordinator, Viatris).
const MANAGER_TITLE_RE = /\b(manager|director|lead|head|gerente|diretor|líder|lider)\b/i;

/**
 * Build a canonical stable URL from a jk key.
 * The `jk` param is the durable dedup key; strip all tracking params.
 *
 * @param {string} jk
 * @returns {string}
 */
function buildJobUrl(jk) {
  return `https://br.indeed.com/viewjob?jk=${encodeURIComponent(jk)}`;
}

/**
 * Build the Indeed search URL from entry fields.
 *
 * @param {string} query  — raw search_text (NOT URL-encoded yet)
 * @param {string} location
 * @param {number} fromage — max age in days
 * @param {number} start   — pagination offset (0-based, step by 10)
 * @returns {string}
 */
function buildSearchUrl(query, location, fromage, start) {
  const params = new URLSearchParams({
    q: query,
    sort: 'date',
    fromage: String(fromage),
    start: String(start),
  });
  if (location) params.set('l', location);
  return `https://br.indeed.com/jobs?${params.toString()}`;
}

/**
 * Parse today's date as YYYY-MM-DD for "hoje"/"today" relative dates.
 *
 * @returns {string}
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Convert a relative Indeed date hint to YYYY-MM-DD.
 * Indeed Brazil shows: "hoje", "há 1 dia", "há 3 dias", "há 7 dias", "30+ dias".
 *
 * @param {string} raw
 * @returns {string|undefined}
 */
function parseRelativeDate(raw) {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase();
  if (norm === 'hoje' || norm === 'today' || norm.includes('agora')) return todayISO();
  const m = norm.match(/h[áa]\s+(\d+)\s+dia/);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(m[1], 10));
    return d.toISOString().slice(0, 10);
  }
  // Absolute ISO date embedded in HTML (rare but seen in structured snippets)
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return undefined;
}

/**
 * Extract job cards from raw Indeed HTML.
 * Indeed's HTML structure (observed 2026-05-25):
 *   <a data-jk="XXXXXXXX" ...>  — one per job card
 *   <span data-testid="jobTitle">TITLE</span>
 *   <span data-testid="company-name">...</span>   or aria-label on <a data-company-name>
 *   <div data-testid="text-location">CITY, STATE</div>
 *   <span data-testid="myJobsStateDate">... há N dias ...</span>
 *
 * @param {string} html
 * @param {string} company_override  — when entry has company set
 * @returns {Array<{jk:string, title:string, company:string, location:string, dateHint:string}>}
 */
function extractCards(html, company_override) {
  /** @type {Array<{jk:string, title:string, company:string, location:string, dateHint:string}>} */
  const cards = [];
  const seen = new Set();

  // Extract all data-jk values from anchor tags.
  // Each <a data-jk="..."> is one job card.
  const jkRe = /data-jk="([a-f0-9]{8,20})"/gi;
  let jkMatch;
  while ((jkMatch = jkRe.exec(html)) !== null) {
    const jk = jkMatch[1];
    if (seen.has(jk)) continue; // dedupe sponsored/organic duplicates
    seen.add(jk);

    // Grab a window of HTML around the jk anchor for field extraction.
    // 3000 chars covers a typical card block without bleeding into next card.
    const start = Math.max(0, jkMatch.index - 200);
    const end = Math.min(html.length, jkMatch.index + 3000);
    const chunk = html.slice(start, end);

    // Title: <span data-testid="jobTitle">...</span>
    const titleM = chunk.match(/data-testid="jobTitle"[^>]*>([^<]+)<\/span>/i)
      || chunk.match(/class="[^"]*jobTitle[^"]*"[^>]*>([^<]+)</i);
    const title = titleM ? titleM[1].replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10))).trim() : '';

    // Company: data-testid="company-name" or aria-label on company anchor
    const companyM = chunk.match(/data-testid="company-name"[^>]*>([^<]+)<\/span>/i)
      || chunk.match(/aria-label="([^"]+)" data-testid="company-name"/i);
    const company = company_override
      || (companyM ? companyM[1].replace(/&amp;/g, '&').trim() : '');

    // Location: data-testid="text-location"
    const locM = chunk.match(/data-testid="text-location"[^>]*>([^<]+)<\/div>/i)
      || chunk.match(/data-testid="text-location"[^>]*>([^<]+)</i);
    const location = locM ? locM[1].replace(/&amp;/g, '&').trim() : '';

    // Date: data-testid="myJobsStateDate" or "date" class
    const dateM = chunk.match(/data-testid="myJobsStateDate"[^>]*>([^<]+)</i)
      || chunk.match(/class="[^"]*date[^"]*"[^>]*>([^<]+)</i);
    const dateHint = dateM ? dateM[1].trim() : '';

    if (!title || !jk) continue;
    cards.push({ jk, title, company, location, dateHint });
  }
  return cards;
}

/** @type {Provider} */
export default {
  id: PROVIDER_ID,

  /**
   * Match portal entries declaring `provider: indeed` or scan_method + provider.
   * @param {PortalEntry} entry
   * @returns {boolean}
   */
  detect(entry) {
    return entry?.scan_method === 'provider' && entry?.provider === PROVIDER_ID;
  },

  /**
   * @param {PortalEntry & {
   *   search_text?: string,
   *   location?: string,
   *   fromage?: number,
   *   date_since_posted?: number,
   *   limit?: number,
   *   exclude_seniority?: boolean,
   *   company_override?: string,
   * }} entry
   * @param {Context} ctx
   * @returns {Promise<Job[]>}
   */
  async fetch(entry, ctx) {
    const searchText = (entry.search_text || 'assuntos regulatorios farmaceutico').trim();
    const location = (entry.location || 'Brasil').trim();
    // fromage: max age in days (Indeed: 1, 3, 7, 14, 30)
    // entry.fromage takes precedence; fallback to entry.date_since_posted; then default.
    const fromage = entry.fromage ?? entry.date_since_posted ?? DEFAULT_FROMAGE;
    const limit = entry.limit ?? DEFAULT_LIMIT;
    // Whether to apply the built-in Manager/Director/Lead/Head filter.
    // Enabled by default (matches Vitor's seniority constraint in _profile.md).
    const excludeSeniority = entry.exclude_seniority !== false;
    const companyOverride = entry.company_override || '';

    /** @type {Job[]} */
    const results = [];
    const seenJks = new Set();

    // Paginate in steps of 10 (Indeed's page size) until we hit limit or run dry.
    const pagesNeeded = Math.ceil(limit / 10);
    for (let page = 0; page < pagesNeeded; page++) {
      const start = page * 10;
      const url = buildSearchUrl(searchText, location, fromage, start);

      let html;
      try {
        html = await ctx.fetchText(url, {
          timeoutMs: REQUEST_TIMEOUT_MS,
          headers: {
            // Present as a browser to avoid immediate CAPTCHA/302 redirect.
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
          },
        });
      } catch (err) {
        // Log and bail gracefully — network errors or CAPTCHA 403/429.
        process.stderr.write(
          `[indeed] WARN: fetch failed (page=${page} q="${searchText}" l="${location}"): ${err.message}\n`,
        );
        break; // stop pagination, return what we have so far
      }

      // Detect CAPTCHA / empty response
      if (!html || html.length < 500) {
        process.stderr.write(`[indeed] WARN: empty/short response (page=${page}), stopping.\n`);
        break;
      }
      if (html.includes('captcha') || html.includes('verify you are human') || html.includes('unusual traffic') || html.includes('cf-challenge')) {
        process.stderr.write(`[indeed] WARN: CAPTCHA/bot-check detected (page=${page}), stopping.\n`);
        break;
      }

      const cards = extractCards(html, companyOverride);
      if (cards.length === 0) break; // no more results

      for (const card of cards) {
        if (results.length >= limit) break;
        if (seenJks.has(card.jk)) continue;
        seenJks.add(card.jk);

        // Post-fetch seniority filter (Indeed boolean negation is broken — confirmed 2026-05-25).
        // See modes/_profile.md § Seniority Constraint.
        if (excludeSeniority && MANAGER_TITLE_RE.test(card.title)) {
          process.stderr.write(`[indeed] SKIP (seniority): "${card.title}"\n`);
          continue;
        }

        /** @type {Job} */
        const job = {
          title: card.title,
          // Canonical stable URL: strip all tracking params, keep only jk.
          url: buildJobUrl(card.jk),
          company: card.company,
          // v1 compat: location is the free-form label from the listing
          location: card.location,
          // v2: location_real = same source; richer value may come from JD detail page
          location_real: card.location,
          // v2: work_mode and br_eligible are UNKNOWN at list-page level.
          // pre-apply-check.mjs enriches these when Vitor opens a specific JD.
          work_mode: 'UNKNOWN',
          br_eligible: 'UNKNOWN',
        };

        // v2.1: posted_at when we can parse the relative date hint
        const posted_at = parseRelativeDate(card.dateHint);
        if (posted_at) job.posted_at = posted_at;

        results.push(job);
      }
      if (results.length >= limit) break;
    }

    process.stderr.write(
      `[indeed] q="${searchText}" l="${location}" fromage=${fromage} → ${results.length} jobs returned\n`,
    );
    return results;
  },
};
