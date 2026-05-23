# STEAL 4 — RSS Provider Smoke (parser-proof)

**Run:** 2026-05-23 14:35 GMT-3
**Branch:** `feat/rss-providers`
**Provider:** `providers/rss.mjs` (RSS 2.0 + Atom 1.0 via `fast-xml-parser`)

## Framing

The COTSK-10 spec named Nature Careers and BioSpace as RSS job sources.
**Recon found neither exposes a job RSS feed today** (Nature's feeds 404
or redirect to HTML; BioSpace `/rss-feeds` lists only industry-news feeds,
no `/jobs/...` RSS). The provider is correct generic infrastructure for
any future RSS/Atom job source Vitor wires up; this smoke proves the
parser works against real-world feeds — it is NOT pretending to find jobs
in news streams.

## Feeds smoked

| feed | format | items | elapsed | posted_at | employment_type | RA-filtered |
|------|--------|-------|---------|-----------|-----------------|-------------|
| BioSpace FDA News           | RSS 2.0 | 10 | 1276ms | 100% | 0% | 0/10 |
| BioSpace Drug Development   | RSS 2.0 | 10 |  453ms | 100% | 0% | 0/10 |
| BioSpace Policy             | RSS 2.0 | 10 |  200ms | 100% | 0% | 0/10 |
| fast-xml-parser releases    | Atom    | 10 |  483ms | 100% | 0% | 0/10 |

40 items mapped to v2.1 Job shape, zero parser crashes, zero WARN logs.

RA-relevant title filter (`/\b(regulatory|reg(\s|-)?affairs|assuntos\s*regulat[oó]rio|regulat[oó]ri[oa])\b/i`)
matched **0/40** — expected and correct, because the only available feeds
on the originally-named sources are news/release streams, not job
listings.

## What the smoke proves

- RSS 2.0 `<channel><item>` → Job mapping works.
- Atom 1.0 `<feed><entry>` → Job mapping works, including the
  `<link href="..."/>` attribute path.
- `pubDate` RFC 822 dates and Atom `published` ISO 8601 dates both
  truncate cleanly to `YYYY-MM-DD`.
- `posted_at` populated 100% across both formats — same as STEAL 2 Gupy
  API path coverage.
- Provider survives `<dc:creator>`, `<guid>`, `<media:*>`, and other
  RSS 2.0 namespace extensions present in BioSpace feeds.
- Detection via `FEED_URL_HINT` (`/rss`, `/feed`, `/atom`, `.rss`,
  `.atom`, `.xml`) plus explicit `provider: rss` opt-in.

## What the smoke does NOT prove

- That a real job RSS feed exists for the originally-named sources.
- That a job RSS, when found, will populate `work_mode` or `br_eligible`.
  (News/release feeds don't expose work-mode; the pre-apply enrich step
  resolves them downstream on URLs the user actually opens.)

## Coverage delta vs prior state

- Before: zero RSS/Atom feed support across the system.
- After:  any RSS 2.0 or Atom 1.0 URL that surfaces in portals.yml
  (with `provider: rss` or a URL ending in `.rss`/`.atom`/etc.) is now
  scannable end-to-end.

## Decision pending Vitor

No portals.yml entries proposed. Neither Nature Careers nor BioSpace
delivers job listings via RSS today. Options Vitor can pick from in a
separate prompt:

1. **Shelve the RSS path** until a real job RSS source surfaces.
2. **Repurpose for RA-relevant industry intelligence** (FDA, policy,
   drug-development news feeds) as a separate concept from the job
   pipeline. Would need a separate intake (the current pipeline assumes
   `url` is an applyable JD).
3. **Hunt for alternative job RSS sources** — e.g. BMJ Careers, Naturejobs
   archive, regional pharma boards, ATS aggregators that still offer RSS.
