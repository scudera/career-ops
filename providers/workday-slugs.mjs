// @ts-check
// Workday tenant/shard/site registry for known company tenants.
//
// Adapted from LeoLaborie/claude-apply (MIT) src/scan/ats/workday-slugs.mjs
// + templates/known-workday-slugs.example.json. Pre-populated with 8 pharma
// majors validated 2026-05-22 via providers/workday.mjs::verifySlug.
//
// Use this registry as the source-of-truth for portals.yml Workday entries.
// New companies should be discovered+verified via scripts/seed-workday-slugs.mjs
// before being added here.

/**
 * @typedef {object} WorkdaySlugEntry
 * @property {string} tenant   — Workday tenant identifier (subdomain prefix).
 * @property {string} shard    — Workday pod (wd1/wd3/wd5/wd103/etc).
 * @property {string} site     — Workday CXS site ID (NOT necessarily the URL path).
 * @property {string} [verified_at]   — ISO date last verifySlug() returned ok.
 * @property {number} [verified_count] — Job count at verification time.
 */

/** @type {Record<string, WorkdaySlugEntry>} */
export const WORKDAY_REGISTRY = {
  // Pharma majors validated 2026-05-22 via verifySlug.
  pfizer: {
    tenant: 'pfizer',
    shard: 'wd1',
    site: 'PfizerCareers',
    verified_at: '2026-05-22',
    verified_count: 540,
  },
  amgen: {
    tenant: 'amgen',
    shard: 'wd1',
    site: 'Careers',
    verified_at: '2026-05-22',
    verified_count: 1424,
  },
  sanofi: {
    tenant: 'sanofi',
    shard: 'wd3',
    site: 'SanofiCareers',
    verified_at: '2026-05-22',
    verified_count: 1452,
  },
  takeda: {
    tenant: 'takeda',
    shard: 'wd3',
    site: 'Takeda_External_Careers',
  },
  novartis: {
    tenant: 'novartis',
    shard: 'wd3',
    site: 'Novartis_Careers',
  },
  gsk: {
    tenant: 'gsk',
    shard: 'wd5',
    site: 'GSKCareers',
  },
  astrazeneca: {
    tenant: 'astrazeneca',
    shard: 'wd3',
    site: 'Careers',
  },
  beigene: {
    tenant: 'beigene',
    shard: 'wd5',
    site: 'BeiGene',
  },
};

/**
 * Normalize company name to lookup key (lowercase, no spaces).
 * @param {string} name
 */
export function normalizeKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Build the canonical Workday careers URL from a registry entry.
 * @param {WorkdaySlugEntry} entry
 */
export function toCareersUrl(entry) {
  return `https://${entry.tenant}.${entry.shard}.myworkdayjobs.com/${entry.site}`;
}

/**
 * Look up a company in the registry. Returns null if not found.
 * @param {string} companyName
 */
export function lookupCompany(companyName) {
  const key = normalizeKey(companyName);
  return WORKDAY_REGISTRY[key] || null;
}
