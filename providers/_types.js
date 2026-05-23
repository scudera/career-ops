// Type catalog for the provider plugin contract.
//
// This file is documentation-only — pure JSDoc @typedef annotations. The
// project is plain ESM JavaScript with no build step; provider authors can
// reference these types via `/** @typedef {import('./_types.js').Provider} Provider */`
// at the top of a `// @ts-check`-enabled file to get IDE hints. The runtime
// contract is enforced by scan.mjs (id presence, fetch is a function, fetch
// returns an array), not by these annotations.
//
// Files prefixed with _ are never loaded as providers by scan.mjs.

/**
 * Normalized job posting — the unit of currency throughout the scanner.
 *
 * Schema v2 (CP2 22/may/26): added `work_mode`, `br_eligible`, `location_real`.
 * Providers that can extract these natively (Gupy `workplaceType`, Workable
 * `workplace_type`, Workday `applicantLocationRequirements`) populate them.
 * Providers without native signal (Phenom, SmartRec list pages, LinkedIn)
 * leave them undefined or set to 'UNKNOWN' — `filter-candidates.mjs` and the
 * pre-apply-check enrich step resolve them downstream.
 *
 * @typedef {('REMOTE'|'HYBRID'|'ON_SITE'|'UNKNOWN')} WorkMode
 * @typedef {('BR_OK'|'RELOCATION_REQUIRED'|'UNKNOWN')} BrEligible
 *
 * @typedef {object} Job
 * @property {string}      title          Required, non-empty after trim.
 * @property {string}      url            Required, absolute URL — used as the dedup key.
 * @property {string}      company        May be empty when source can't expose it.
 * @property {string}      location       Free-form location label (legacy v1 field; may differ from JD).
 * @property {WorkMode}    [work_mode]    v2 — when provider can extract natively.
 * @property {BrEligible}  [br_eligible]  v2 — when provider can determine.
 * @property {string}      [location_real] v2 — canonical address from JD when known.
 */

/**
 * A single `tracked_companies` entry from `portals.yml`.
 *
 * Provider-specific fields are opaque to scan.mjs and validated by the
 * provider itself. Examples in current providers: `api`, `careers_url`.
 * Providers read these directly off the entry object — no schema enforcement
 * at the framework level.
 *
 * @typedef {object} PortalEntry
 * @property {string}             name             User-facing label; appears in logs and placeholders.
 * @property {boolean}            [enabled]        Default: true.
 * @property {string}             [careers_url]    Public listing URL; consumed by detect().
 * @property {string}             [provider]       Explicit provider id — bypasses detect().
 * @property {('http')}           [transport]      Default: 'http'. Reserved for future transports.
 */

/**
 * Returned by `detect()` when a provider claims an entry. `url` is
 * informational (used in logs); routing only checks for a non-null return.
 *
 * @typedef {object} DetectHit
 * @property {string} url
 */

/**
 * Options forwarded to the underlying `fetch` call.
 *
 * @typedef {object} FetchOptions
 * @property {number}                [timeoutMs]
 * @property {Object<string,string>} [headers]
 * @property {string}                [method]
 * @property {(string|null)}         [body]
 */

/**
 * What scan.mjs hands to provider.fetch(). For Phase A only `transport: 'http'`
 * is implemented; the shape reserves room for future transports without
 * breaking the contract.
 *
 * @typedef {object} Context
 * @property {('http')} transport
 * @property {(url: string, opts?: FetchOptions) => Promise<string>}  fetchText
 * @property {(url: string, opts?: FetchOptions) => Promise<unknown>} fetchJson
 */

/**
 * The provider contract — the default export of every providers/*.mjs file
 * (excluding _-prefixed shared helpers).
 *
 * @typedef {object} Provider
 * @property {string} id                                                       Unique across all loaded providers.
 * @property {((entry: PortalEntry) => (DetectHit | null))} [detect]           Optional auto-detection.
 * @property {(entry: PortalEntry, ctx: Context) => Promise<Job[]>} fetch      Required.
 */

export {};
