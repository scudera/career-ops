# pipeline.md schema v2.1

## Motivação

Sessão 22/may/26 expôs 3 gaps no schema v1:

1. **work_mode missing** — pipeline.md v1 carregava só title/url/company/location. Sem signal de remote/hybrid/on-site, ranking ignorava a policy mais importante do Vitor (location decrescente).
2. **Label drift** — IQVIA `R1519241` apareceu labeled `(Oeiras, Portugal)` mas JD real diz "São Paulo, Brazil". Title string não é source-of-truth.
3. **Tier não persisted** — classificação tier era recalculada ad-hoc por scripts auxiliares; sem campo no pipeline = sem ordering persistido.

## 4 campos novos

### `work_mode` — modelo de trabalho

| valor | semântica |
|---|---|
| `REMOTE` | 100% home-based / WFH |
| `HYBRID` | mix on-site/remote (qualquer split) |
| `ON_SITE` | 100% escritório |
| `UNKNOWN` | JD silent ou parse failed |

**Source priority:**
1. JSON-LD `jobLocationType` (TELECOMMUTE → REMOTE)
2. Provider-native enum (Gupy `workplaceType`, Workable `workplace_type`)
3. Body innerText regex fallback (PT+EN keyword list)

### `br_eligible` — elegibilidade pra candidato BR-resident

| valor | semântica |
|---|---|
| `BR_OK` | aceita candidato baseado no Brasil (sem relocate) |
| `RELOCATION_REQUIRED` | exige geo específica não-BR (mesmo se REMOTE c/ country restriction) |
| `UNKNOWN` | sem signal claro |

**Source priority:**
1. JSON-LD `jobLocation[].address.addressCountry` (multi-location parse, NÃO só primeiro)
2. JSON-LD `applicantLocationRequirements`
3. Body innerText `relocation` keywords

### `tier` — bucket ranking (1=best, 4=worst)

| tier | regra | semântica |
|---|---|---|
| 1 | REMOTE + BR_OK | best fit — full remote BR-resident accepted |
| 2 | HYBRID + BR_OK | BR híbrido / remote EU validado c/ BR_OK |
| 3 | (ON_SITE + BR_OK) OR (HYBRID + UNKNOWN br_eligible) OR (UNKNOWN + BR_OK) OR (REMOTE + UNKNOWN br_eligible) | BR on-site OU pre-resolution ambiguous |
| 4 | RELOCATION_REQUIRED OR ON_SITE non-BR | descartar (Vitor policy: relocação não é goal) |

**Edge case explícito:** `UNKNOWN work_mode + BR_OK br_eligible` → Tier 3 (advisor fix 22/may — fallback default era Tier 4, agora coberto).

**Edge case resolved (CP1 sign-off → CP2):** `REMOTE + UNKNOWN br_eligible` → **Tier 3** (não Tier 2). Conservative — não inflar Tier 2 com falso-positivos de ATSes sem JSON-LD (ex: LinkedIn body match "remote" pode ser US-only / country-restricted). Pre-apply-enrich em CP3 resolve UNKNOWN via JD fetch profundo e promove pra Tier 1/2/4 conforme dado real. Sem campo `verify_required` no schema — UNKNOWN é signal suficiente.

### `location_real` — endereço canonical do JD

String free-form extraída de JSON-LD `jobLocation[0].address` ou body header. Substitui label do título (que sofreu drift no caso IQVIA).

Format: `Locality, Region, Country` ou `Remote in N countries [c1, c2, ...]` quando multi-location REMOTE.

## Encoding inline pipeline.md

### v1 (atual, baseline)

```
- [ ] https://url | Company | Job Title (Optional Location)
```

### v2 (proposta — backward compatible)

```
- [ ] https://url | Company | Job Title | T=N wm=WM br=BR loc=Location Real
```

**4o pipe-delimited field carrega metadata v2.** Parsers v1 (que olham só os 3 primeiros campos) ignoram silently. Parsers v2 extraem com regex `T=(\d) wm=(\w+) br=(\w+) loc=(.+)`.

Exemplo:

```
- [ ] https://jobs.thermofisher.com/.../R-01341889/... | PPD (Thermo Fisher) | RA Specialist II IVD Medical Devices | T=2 wm=HYBRID br=BR_OK loc=São Paulo, Brazil
```

### Migração

`scripts/migrate-pipeline-schema.mjs` (não destrutivo):

- Lê `data/pipeline.md` v1
- Re-classifica entries (best-effort via `scripts/inspect-jds.mjs`)
- Escreve `data/pipeline-v2.md` (preserva v1)
- Por entry sem URL valid OR classification failed: mantém linha v1 sem metadata (não silently coerce UNKNOWN+BR_OK pra Tier qualquer)

## Validação no parse

Schema validator rejeita silently coerce:

- `work_mode` ∉ enum → fail loudly (não default UNKNOWN)
- `br_eligible` ∉ enum → fail loudly
- `tier` ∉ {1, 2, 3, 4} → fail loudly
- `location_real` empty string permitido (JD silent é signal valid)

Quando metadata v2 ausente da linha (linha v1 legada), parser retorna `{tier: null, work_mode: null, br_eligible: null}` — não coerce.

---

# v2.1 expansion (COTSK-7 23/may/26)

## Motivação

Deep search OSS (22/may/26) identificou career-ops como tendo schema bare-bones (4 campos v1) vs jobhive (23) e ever-jobs (~30). v2 adicionou 4 (work_mode/br_eligible/tier/location_real). v2.1 adiciona 7 high-value flat fields.

**Big finding pré-v2.1**: scan.mjs `appendToPipeline` escrevia só 3 fields (`url | company | title`) — metadata v2 nunca foi persistido em pipeline.md. v2.1 wires entire v2.0 + v2.1 serialization chain pela primeira vez.

## 7 campos novos (todos optional, flat)

| Campo | Type | Source per provider |
|---|---|---|
| `employment_type` | enum (closed) | Workday `timeType`, Gupy `type`, Workable `employment_type`, Phenom JSON-LD `employmentType`, SmartRec `experience` |
| `compensation_min` | number | Ashby/Greenhouse metadata, Workable salary range, Phenom JSON-LD `baseSalary.value.minValue` |
| `compensation_max` | number | mesmos providers |
| `compensation_currency` | string (ISO 4217) | USD / BRL / EUR / GBP / etc. |
| `compensation_period` | enum (closed) | HOUR / DAY / WEEK / MONTH / YEAR / UNKNOWN |
| `posted_at` | YYYY-MM-DD | Workday `postedOn` (parsed from "Posted N Days Ago"), Gupy `publishedDate`, Workable `published_on`, Phenom JSON-LD `datePosted` |
| `apply_url` | string (URL) | URL direto para form quando distinto da listing URL — Workday CXS, Gupy redirect, Workable apply_url |

### Enum `employment_type` (closed)

```
FULL_TIME | PART_TIME | CONTRACT | INTERN | TEMPORARY | UNKNOWN
```

Mappings per provider:
- Workday `timeType`: `Full time` → FULL_TIME, `Part time` → PART_TIME
- Gupy `type`: `effective` → FULL_TIME, `intern` → INTERN, `trainee` → INTERN, `temporary` → TEMPORARY
- Workable `employment_type`: `full-time` → FULL_TIME, `part-time` → PART_TIME, `contract` → CONTRACT, `internship` → INTERN, `temporary` → TEMPORARY
- Phenom JSON-LD schema.org: FULL_TIME, PART_TIME, CONTRACTOR → CONTRACT, TEMPORARY → TEMPORARY, INTERN → INTERN, VOLUNTEER/PER_DIEM/OTHER → UNKNOWN
- SmartRec: TBD per response shape (não documentado pelo provider)

### Enum `compensation_period` (closed)

```
HOUR | DAY | WEEK | MONTH | YEAR | UNKNOWN
```

Phenom JSON-LD `baseSalary.value.unitText` mapeia direto. Outros providers normalizam pra YEAR quando reportam annual range.

### `posted_at` format

**YYYY-MM-DD only.** Time component truncado mesmo quando provider expõe full ISO timestamp (decisão Vitor — providers reportam dia, time é raro útil). Writer SEMPRE emite date-only.

**Workday quirk**: `postedOn` vem como `"Posted 9 Days Ago"` (string humana), não ISO. Provider parser converte pra date relativa (today - N days).

### `apply_url` rule

Só escrever quando **distinto** da listing `url`. Se provider expõe applyUrl idêntico, omit.

## Encoding inline pipeline.md

### v2.0 (deprecated mas mantido pra compat) — write site previously absent

```
- [ ] URL | Company | Title | T=N wm=WM br=BR loc=Location Real
```

### v2.1 (NOVO — primeira vez serialized end-to-end)

```
- [ ] URL | Company | Title | T=N wm=WM br=BR loc=Location Real | et=ET cmin=N cmax=N ccy=CCY cper=PER posted=YYYY-MM-DD apply=URL
```

**5o pipe-delimited field carrega v2.1 metadata.** Tokens space-separated, todos individualmente optional, **omit tokens sem valor** (não escrever `cmin=` vazio).

### Ordem de pipes

| pipe | field | format |
|---|---|---|
| `[0]` | `- [ ]` checkbox + URL | `https://...` |
| `[1]` | Company | free-form |
| `[2]` | Title | free-form (legacy v1 location hint em parens) |
| `[3]` | v2.0 metadata (optional) | `T=N wm=WM br=BR loc=...` |
| `[4]` | v2.1 metadata (optional) | `et=ET cmin=N cmax=N ccy=CCY cper=PER posted=YYYY-MM-DD apply=URL` |

### Coexistência 3 formats

Pipeline.md aceita 3, 4 ou 5 pipes silenciosamente:
- **3 pipes (v1 legacy)**: all v2/v2.1 fields parsed como null
- **4 pipes (v2.0)**: v2 fields populated, v2.1 null
- **5 pipes (v2.1)**: ambos populated

Sem migração obrigatória. Old entries permanecem como estão; novo scan escreve v2.1.

## Parse regexes

```js
// filter-candidates.mjs
const V2_SUFFIX_RE  = /T=(\d)\s+wm=(\w+)\s+br=(\w+)(?:\s+loc=(.+))?$/;        // unchanged
const V21_SUFFIX_RE = /(?:et=(\w+))?\s*(?:cmin=(\d+))?\s*(?:cmax=(\d+))?\s*(?:ccy=(\w+))?\s*(?:cper=(\w+))?\s*(?:posted=([\d-]+))?\s*(?:apply=(\S+))?/;
```

Each v2.1 token capture group independently optional. Caller checks `parts[4]?.includes('=')` before applying regex (defensive — empty parts[4] shouldn't match all-undefined).

## Validação ao parse

- `employment_type` ∉ enum closed → null (não silently coerce)
- `compensation_period` ∉ enum closed → null
- `compensation_min/max` parse via `parseInt` — se NaN, null
- `posted_at` regex `/^\d{4}-\d{2}-\d{2}$/` strict — não-conformante → null
- `apply_url` precisa parsear como URL absoluta — senão null

## Decisões Vitor (lock)

- **Flat** (não nested objects)
- **`descriptionText` NÃO persisted** em pipeline.md — runtime-only quando precisar fetch
- **Backward compat** obrigatório com entries v2.0 (na verdade v1, já que v2.0 nunca foi escrito)
