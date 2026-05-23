// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
/** @typedef {import('./_types.js').PortalEntry} PortalEntry */
/** @typedef {import('./_types.js').Context} Context */

import { XMLParser } from 'fast-xml-parser';
import { truncateDateISO } from '../classify-work-mode.mjs';

// Generic RSS 2.0 + Atom 1.0 provider.
//
// Reads any public feed exposed as application/rss+xml or
// application/atom+xml. Maps each item/entry to a v2.1 Job:
//   title       → title       (required)
//   link/href   → url          (required)
//   pubDate /
//   published   → posted_at    (truncated to YYYY-MM-DD)
//   description /
//   summary     → used for classifyFromText (work_mode hint), NOT persisted
//   category    → employment_type best-effort (Full-time / Part-time / ...)
//
// Feeds rarely expose structured location/work_mode/compensation, so most
// items will leave work_mode/br_eligible as UNKNOWN. The pre-apply-check
// enrich step resolves those downstream on URLs the user actually opens.

const REQUEST_TIMEOUT_MS = 15_000;
// Match feeds by URL hint OR explicit `provider: rss` opt-in via portals.yml.
const FEED_URL_HINT = /(?:\/rss(?:[\/.?]|$)|\/feed(?:[\/.?]|$)|\/atom(?:[\/.?]|$)|\.rss(?:$|\?)|\.atom(?:$|\?)|\.xml(?:$|\?))/i;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: false,
});

/**
 * Decode a single XML node into a plain text string. fast-xml-parser may
 * return either a primitive, an object with `#text` (mixed content), or an
 * object with `#cdata` (CDATA-wrapped). Atom links carry an `@_href` attr.
 *
 * @param {unknown} node
 * @returns {string}
 */
function nodeToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join(' ');
  if (typeof node === 'object') {
    const obj = /** @type {Record<string,unknown>} */ (node);
    if (typeof obj['#cdata'] === 'string') return obj['#cdata'];
    if (typeof obj['#text'] === 'string') return obj['#text'];
    if (typeof obj['@_href'] === 'string') return obj['@_href'];
  }
  return '';
}

/**
 * Pull the first matching key from a node, prioritizing namespace-prefixed
 * variants if needed (e.g. `dc:creator` falls back to `creator`).
 *
 * @param {Record<string,unknown>} obj
 * @param {string[]} keys
 * @returns {unknown}
 */
function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return null;
}

/**
 * Extract the href from an Atom <link> node, which may be:
 *   - { '@_href': 'https://...', '@_rel': 'alternate' }
 *   - Array of link nodes (multiple rels: alternate, self, enclosure...)
 *   - A bare string (rare, non-conformant)
 *
 * @param {unknown} link
 * @returns {string}
 */
function atomLinkToHref(link) {
  if (!link) return '';
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) {
    // Prefer rel="alternate" or no rel (which defaults to alternate per spec).
    const alt = link.find((l) => {
      const rel = l && typeof l === 'object' ? l['@_rel'] : null;
      return !rel || rel === 'alternate';
    });
    if (alt) return atomLinkToHref(alt);
    return atomLinkToHref(link[0]);
  }
  if (typeof link === 'object') {
    const href = /** @type {any} */(link)['@_href'];
    if (typeof href === 'string') return href;
    return nodeToText(link);
  }
  return '';
}

/**
 * Best-effort employment_type from RSS <category> or Atom <category>.
 * Categories are typically domain-specific tags; we only recognize a few
 * common employment-status terms.
 *
 * @param {unknown} categoryNode
 * @returns {string|undefined}
 */
function employmentTypeFromCategory(categoryNode) {
  if (!categoryNode) return undefined;
  const arr = Array.isArray(categoryNode) ? categoryNode : [categoryNode];
  for (const c of arr) {
    // RSS <category>Full-time</category>  |  Atom <category term="Full-time"/>
    const raw = typeof c === 'string' ? c
      : (typeof c === 'object' ? (/** @type {any} */(c)['@_term'] || nodeToText(c)) : '');
    const norm = String(raw || '').trim().toLowerCase();
    if (!norm) continue;
    if (/^full[\s-]?time$/.test(norm)) return 'FULL_TIME';
    if (/^part[\s-]?time$/.test(norm)) return 'PART_TIME';
    if (/^contract(?:or)?$/.test(norm)) return 'CONTRACT';
    if (/^intern(?:ship)?$/.test(norm)) return 'INTERN';
    if (/^temp(?:orary)?$/.test(norm)) return 'TEMPORARY';
  }
  return undefined;
}

/**
 * Parse an RFC 822 date string (RSS 2.0 pubDate) or ISO 8601 (Atom published)
 * into a YYYY-MM-DD string.
 *
 * @param {unknown} raw
 * @returns {string|undefined}
 */
function parseFeedDate(raw) {
  if (!raw) return undefined;
  const s = typeof raw === 'string' ? raw : nodeToText(raw);
  if (!s) return undefined;
  // Atom is already ISO 8601 — let truncateDateISO handle it.
  const iso = truncateDateISO(s);
  if (iso) return iso;
  // RSS 2.0 RFC 822: "Fri, 22 May 2026 11:06:00 GMT". Date() handles it.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * Detect RSS 2.0 vs Atom from the parsed root. Returns the items array and a
 * label for logging.
 *
 * @param {Record<string,any>} root
 * @returns {{format: 'rss'|'atom'|'unknown', items: any[], channelTitle: string}}
 */
function locateItems(root) {
  if (root?.rss?.channel) {
    const ch = root.rss.channel;
    const items = Array.isArray(ch.item) ? ch.item : (ch.item ? [ch.item] : []);
    return { format: 'rss', items, channelTitle: nodeToText(ch.title) };
  }
  if (root?.feed) {
    const f = root.feed;
    const items = Array.isArray(f.entry) ? f.entry : (f.entry ? [f.entry] : []);
    return { format: 'atom', items, channelTitle: nodeToText(f.title) };
  }
  return { format: 'unknown', items: [], channelTitle: '' };
}

/**
 * @param {PortalEntry & { search_text?: string, remote_only?: boolean, company_override?: string }} entry
 */
function detect(entry) {
  if (entry?.provider === 'rss') return { url: entry.url || entry.careers_url || '' };
  const u = entry?.url || entry?.careers_url || '';
  if (typeof u !== 'string' || !u) return null;
  if (FEED_URL_HINT.test(u)) return { url: u };
  return null;
}

/**
 * @param {PortalEntry & { search_text?: string, remote_only?: boolean, company_override?: string }} entry
 * @param {Context} ctx
 * @returns {Promise<Job[]>}
 */
async function fetch(entry, ctx) {
  const feedUrl = entry?.url || entry?.careers_url || '';
  if (!feedUrl) throw new Error('rss: entry has no url');

  const xml = await ctx.fetchText(feedUrl, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  });

  let root;
  try {
    root = xmlParser.parse(xml);
  } catch (err) {
    throw new Error(`rss: XML parse error for ${feedUrl}: ${err?.message || err}`);
  }
  const { format, items, channelTitle } = locateItems(root);
  if (format === 'unknown') {
    process.stderr.write(`[rss] WARN: feed ${feedUrl} matches neither RSS 2.0 nor Atom shape\n`);
    return [];
  }

  const company = String(entry?.company_override || channelTitle || entry?.name || '').trim();
  const searchText = (entry?.search_text || '').trim().toLowerCase();
  const titleFilter = searchText
    ? (/** @type {string} */ title) => title.toLowerCase().includes(searchText)
    : () => true;

  /** @type {Job[]} */
  const out = [];
  for (const it of items) {
    let title, url, dateRaw, categoryNode;
    if (format === 'rss') {
      title = nodeToText(pickFirst(it, ['title']));
      url = nodeToText(pickFirst(it, ['link', 'guid']));
      dateRaw = pickFirst(it, ['pubDate', 'dc:date']);
      categoryNode = it?.category;
    } else {
      title = nodeToText(pickFirst(it, ['title']));
      url = atomLinkToHref(it?.link);
      dateRaw = pickFirst(it, ['published', 'updated']);
      categoryNode = it?.category;
    }
    title = String(title || '').trim();
    url = String(url || '').trim();
    if (!title || !url) continue;
    if (!titleFilter(title)) continue;

    /** @type {Job} */
    const job = {
      title,
      url,
      company,
      location: '',
      work_mode: 'UNKNOWN',
      br_eligible: 'UNKNOWN',
    };
    const posted_at = parseFeedDate(dateRaw);
    if (posted_at) job.posted_at = posted_at;
    const et = employmentTypeFromCategory(categoryNode);
    if (et) job.employment_type = /** @type {any} */ (et);
    out.push(job);
  }
  process.stderr.write(`[rss] feed="${feedUrl}" format=${format} items=${items.length} mapped=${out.length} channel="${channelTitle.slice(0, 60)}"\n`);
  return out;
}

/** @type {Provider} */
const provider = { id: 'rss', detect, fetch };

export default provider;
