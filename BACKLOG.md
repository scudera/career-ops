# Career-ops backlog

## work_mode + br_eligible field — schema + parsers + filter (22/may/26)

**Trigger:** scan 22/may exposed ranking blind spot — 4 top picks ranqueados sem signal de work mode (sinal mais importante da policy de location de Vitor).

**Escopo:**
- Adicionar campos ao schema pipeline.md:
  - `work_mode`: REMOTE | HYBRID | ON_SITE | UNKNOWN
  - `br_eligible`: BR_OK | RELOCATION_REQUIRED | UNKNOWN
- Parsers updates por provider:
  - Workday: parse `locationsText` + `internalCode` (regex Remote/Hybrid)
  - Gupy: extrair `workplaceType` do `__NEXT_DATA__` (enum direto)
  - Workable: extrair `workplace_type` da API (já vem)
  - Phenom: fetch JD individual (+1 request/job custo)
  - SmartRecruiters: extrair campo equivalente
- filter-candidates: work_mode + br_eligible viram tier-1 sort key (acima de seniority)
- Pre-apply-check enriquecimento: se work_mode == UNKNOWN, fetch JD pra resolver

**DoD:**
- Novo scan persiste work_mode no pipeline.md por linha
- filter-candidates rank reflete policy location decrescente
- Top 4 picks do scan 22/may podem ser re-ranked usando dados parseados (smoke test)

**Estimativa:** ~1h

---

## Deep search OSS findings (22/may/26)

Deep search executado em paralelo durante sessão Frente B v2. CP2 decision foi PROCEED as-is (arquitetura career-ops validada por jobhive/ever-jobs/jakemercure28). 6 STEALs identificados:

### STEAL 1 — Workday 2K-cap subdivision (DONE em commit `eae0b79` via COTSK-4)

Implementado em `providers/workday.mjs`. Bug crítico que truncava 60-95% de postings de tenants grandes (Pfizer ~5K → 40 pre-fix, Accenture ~60K cap em 2K). Port do `kalil0321/ats-scrapers` (MIT). Subdivision recursiva por jobFamilyGroup → timeType → workerSubType + dedup por req_id. Inclui fix ortogonal do page-2 `total=0` bug.

### STEAL 2 — Gupy unauth API direta (~30min, ROI alto)

Atualmente career-ops usa Gupy via NEXT_DATA SSR scrape. Existe endpoint público unauth:

```
GET https://employability-portal.gupy.io/api/v1/jobs?jobName={q}&workplaceTypes[]={mode}&limit={n}&offset={n}
```

Sem auth, sem API key, confirmado em 3 scrapers OSS independentes. Validar se cobre mesmos tenants que NEXT_DATA scrape atual — se sim, migrar (menos frágil, mais rápido). Se não, manter dual approach.

Reference: `lucasnunestrabalho99-sudo/telegram-vagas-gupy-bot` (MIT).

### STEAL 3 — Workable + SmartRecruiters + Phenom providers (~1.5h cada)

Career-ops já tem providers Workable/Phenom/SmartRec mas todos OUT (Phenom defer enrich, SmartRec standby). Jobhive tem implementações de referência em Python:

- `workable.py`: API REST limpa
- `smartrecruiters.py`: API com posting-id sequencial
- `phenom.py`: CSRF token GET + POST /widgets (complexo)

Portar quando tiver pharma ATSes nesses providers (TBD via pesquisa de coverage real BR/EU).

Reference: `kalil0321/ats-scrapers` (MIT).

### STEAL 4 — RSS providers (~45min)

Pharma/RA RSS feeds públicos sem auth:

- Nature Careers: http://feeds.nature.com/naturejobs/rss/sciencejobs
- BioSpace: https://www.biospace.com/rss-feeds

Criar `providers/rss.mjs` genérico (parse RSS XML, map pra Job contract). Adicionar feeds em `portals.yml`.

### STEAL 5 — Schema expansion (~4-6h)

Career-ops Job contract hoje: title/url/company/location (4 campos) + work_mode/br_eligible/tier/location_real (4 v2). Total 8.

Jobhive 23 campos, ever-jobs ~30. High-value adicionais que career-ops ainda não tem:

- `employmentType`: Full-time/Part-time/Contract/Intern (Workday `timeType`, Gupy `type`, Workable `workplace`)
- `compensation { min, max, currency, period }`: Ashby tem nativo, Greenhouse via metadata
- `postedAt`: data publicação (todos providers têm)
- `applyUrl`: URL direto pra form (mais robusto que listing URL)
- `descriptionHtml`: body da vaga (pra enrichment + dedup melhor)

Adicionar todos como **OPTIONAL** no `_types.js`, populate where available, preserve backward compat.

### STEAL 6 — JSON-LD robustness tricks do extruct (~1h)

`classify-work-mode.mjs` atual já parsea JSON-LD JobPosting. Extruct (BSD-3) tem 3 tricks de robustez que valem portar:

1. HTML-comment-stripping antes de JSON.parse (alguns sites embedded JSON-LD em `<!-- -->`)
2. `@graph` recursion (JSON-LD spec permite array de objects sob `@graph`, alguns sites usam)
3. Lenient JSON parse fallback via jstyleson (handles trailing commas, single quotes em sites legacy)

~30 LOC adicionais em `classify-work-mode.mjs`.

Reference: `scrapinghub/extruct` (BSD-3).

