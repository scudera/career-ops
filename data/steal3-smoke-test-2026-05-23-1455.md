# STEAL 3 — Provider Enrichment Smoke

**Run:** 2026-05-23 14:55 GMT-3
**Branch:** `feat/providers-enrichment-v2`

## Sub-track A (Phenom enrich) — IMPLEMENTED

Opt-in scan-time JSON-LD enrich for Phenom tenants. Default OFF preserves
CP1's lazy-enrich pattern (pre-apply-check resolves at runtime). Vitor
opts in per scan via `--phenom-enrich`.

### Coverage (search_text='regulat', both real Phenom tenants)

| tenant | jobs | employment_type | posted_at | br_eligible | location_real | work_mode | comp_* | elapsed |
|--------|------|-----------------|-----------|-------------|---------------|-----------|--------|---------|
| Thermo Fisher (jobs.thermofisher.com) | 20 | 100% | 100% | 100% | 100% | 0% | 0% | 11.5s |
| MSD/Merck (jobs.merck.com)            |  7 | 100% | 100% | 100% | 100% | 0% | 0% |  7.6s |

- **employment_type 100%**: Schema.org `employmentType` enum (handles both string and array forms).
- **posted_at 100%**: ISO 8601 `datePosted` → truncated to YYYY-MM-DD.
- **br_eligible 100%**: structured `jobLocation[0].address` → `brEligibleFromStructuredLocation` inference.
- **location_real 100%**: built from structured address fields.
- **work_mode 0%**: neither tenant exposes `jobLocationType=TELECOMMUTE` on these JDs; body-regex fallback runs in pre-apply-check at runtime, unchanged.
- **comp_* 0%**: neither tenant publishes `baseSalary` in public JSON-LD.

### Default OFF verification

Same Thermo URL, no `--phenom-enrich` flag → 6 jobs, all v2.1 fields
undefined, work_mode/br_eligible/location_real UNKNOWN. Sitemap-only path
unchanged from baseline. Zero per-URL HTTP fetches; cost preserved.

### Throttle / cost

- `ENRICH_CONCURRENCY = 3`, `ENRICH_INTER_CHUNK_MS = 200`
- `MAX_ENRICH_URLS = 200` cap per tenant
- Worst case 200 URLs ≈ 3.5 min/tenant. Within the 20s `SITEMAP_TIMEOUT_MS` × N pattern.
- Per-URL failures degrade gracefully (UNKNOWN preserved + stderr log).

### Frame

The "8 Thermo Phenom in CP4 ground truth" referenced in the task spec
were already enriched by the pre-apply-check runtime path. Scan-time
enrich does NOT retroactively help that set; it helps **future** scans
populate v2.1 fields directly in pipeline.md without a separate enrich
step.

## Sub-track B (Workable expansion) — PREMISSA BROKEN

Probed 33 pharma slugs against `https://apply.workable.com/api/v1/widget/accounts/{slug}`:

- 19 slug-accounts resolve (bayer, ucb, biontech, evotec, sanofi, roche, takeda, gsk, novartis, astrazeneca, lilly, msd, viatris, novonordisk, novo-nordisk, servier, grunenthal, almirall, plus pfizer which resolves to "Universidad de la Sabana"). 
- **0/19 with `jobs.length > 0`.** Even the existing Evotec tenant returns 0 jobs today.
- Conclusion: pharma uses Workable for marketing/branding pages, **not** for primary job listings. Active jobs live in Workday / Greenhouse / SAP SuccessFactors / Avature.

**No portals.yml entries proposed.** Sub-track stopped per task spec rule:
"Se Fase A mostrar zero tenants pharma reais hoje, PARAR esse sub-track."

## Sub-track C (SmartRecruiters activation) — PREMISSA BROKEN

Probed 30 pharma slugs against `https://api.smartrecruiters.com/v1/companies/{slug}/postings`:

- All 30 returned HTTP 200 (placeholder API behavior).
- **0/30 with `totalFound > 0`.** Every pharma slug returns an empty job set.
- Conclusion: SmartRec API responds to any company name with a stub response; no pharma org uses SmartRec for public job posting at the namespaces probed.

**No portals.yml entries proposed.** Sub-track stopped same as B.

## Outcome

- **1/3 sub-tracks implemented** (Sub-track A: Phenom enrich + opt-in flag).
- **2/3 sub-tracks documented as premise-broken** (Workable + SmartRec).
- Time spent: ~1.5h (well under 4.5h timebox). Recon-first discipline saved
  ~3h of work on dead ATSes.

## test-all.mjs

93 passed, 1 failed (Dashboard build, pre-existing since `feat/rss-providers`).
Zero regression introduced by these changes.
