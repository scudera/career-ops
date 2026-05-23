# pipeline.md schema v2

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
