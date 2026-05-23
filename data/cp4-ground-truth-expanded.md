# CP4 Ground Truth — Frente B v2 smoke test

**Decisão Vitor (2026-05-23 pós Fase A sign-off):** descartar todas as 18 entries Workday novas descobertas em CP4 Fase A. Razão: 100% Tier 4 RELOCATION_REQUIRED — nenhuma adiciona valor ao smoke test, e distribuição 0/0/0/18 já é sinal claro que sistema funciona corretamente filtrando.

**Resultado:** ground truth permanece nas **12 entries originais** conforme spec COTSK-5. **Nenhuma expansão aplicada.** `pipeline.md` não modificado.

## 12 entries do ground truth (linha = data/pipeline.md)

| # | line | company | role | url | expected tier | expected work_mode | expected br_eligible |
|---|---|---|---|---|---|---|---|
| 1 | 60 | IQVIA Biotech | Regulatory Affairs Officer | https://jobs.iqvia.com/en/jobs/R1519241-0 | **1 OR 3** | varies | varies |
| 2 | 203 | Brainfarma (Gupy) | Analista de Assuntos Regulatórios SÊNIOR | https://brainfarma.gupy.io/job/eyJqb2JJZCI6MTEyMjQxNjAsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs | 3 | ON_SITE | BR_OK |
| 3 | 210 | Cristália (Gupy) | Analista de Assuntos Regulatórios Pl | https://cristalia.gupy.io/job/eyJqb2JJZCI6MTExNTI0MzUsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs | 3 | ON_SITE | BR_OK |
| 4 | 211 | MCassab Nutrição e Saúde Animal (Gupy) | Supervisor(a) de Assuntos Regulatórios | https://mcassabnutricaoesaudeanimal.gupy.io/job/eyJqb2JJZCI6MTA4NTcxNTcsInNvdXJjZSI6Imdvb2dsZV9mb3Jfam9icyJ9?jobBoardSource=google_for_jobs | 3 | ON_SITE | BR_OK |
| 5 | 214 | PPD (Thermo Fisher) | Regulatory Affairs Manager Transplant Diagnostics | https://jobs.thermofisher.com/global/en/job/R-01351891/Regulatory-Affairs-Manager-Transplant-Diagnostics | 4 | varies | RELOCATION_REQUIRED |
| 6 | 215 | PPD (Thermo Fisher) | Supervisor Regulatory Affairs | https://jobs.thermofisher.com/global/en/job/R-01346292/Supervisor-Regulatory-Affairs | 4 | varies | RELOCATION_REQUIRED |
| 7 | 217 | PPD (Thermo Fisher) | Principal Regulatory Affairs Specialist Global CTA | https://jobs.thermofisher.com/global/en/job/R-01350715/Principal-Regulatory-Affairs-Specialist-Global-Clinical-Trial-Applications | 4 | varies | RELOCATION_REQUIRED |
| 8 | 219 | PPD (Thermo Fisher) | Regulatory Affairs Specialist | https://jobs.thermofisher.com/global/en/job/R-01352337/Regulatory-Affairs-Specialist | 4 | varies | RELOCATION_REQUIRED |
| 9 | 220 | PPD (Thermo Fisher) | Regulatory Affairs Manager Global CTA | https://jobs.thermofisher.com/global/en/job/R-01351430/Regulatory-Affairs-Manager-Global-Clinical-Trial-Applications | 4 | varies | RELOCATION_REQUIRED |
| 10 | 221 | PPD (Thermo Fisher) | Regulatory Affairs Specialist II | https://jobs.thermofisher.com/global/en/job/R-01351974/Regulatory-Affairs-Specialist-II | 4 | varies | RELOCATION_REQUIRED |
| 11 | 223 | PPD (Thermo Fisher) | Regulatory Affairs Specialist II IVD Medical Devices | https://jobs.thermofisher.com/global/en/job/R-01341889/Regulatory-Affairs-Specialist-II-IVD-Medical-Devices | **2** | HYBRID | BR_OK |
| 12 | 224 | PPD (Thermo Fisher) | Regulatory Affairs Specialist III Animal Health | https://jobs.thermofisher.com/global/en/job/R-01333958/Regulatory-Affairs-Specialist-III-Animal-Health | 4 | varies | RELOCATION_REQUIRED |

## PASS criteria

- **Entry 1 (IQVIA R1519241)**: Tier ∈ {1, 3} AND `confidence ∈ {majority, unanimous}` (NOT `split-fallback-conservative`)
- **Entries 2-4 (3 Gupy)**: Tier=3, work_mode=ON_SITE, br_eligible=BR_OK (exact)
  - **Caveat known**: Gupy work_mode comes from provider-native `workplaceType` enum AT SCAN TIME, not from live JD body classification. Pre-apply re-classifies via `classifyFromHtml(html, bodyText, url)` which doesn't have the Gupy enum. If body text is silent on PT/EN work-mode keywords, expect UNKNOWN — this is an enum-vs-live-JD divergence, framed at PASS/FAIL time.
- **Entry 11 (PPD R-01341889)**: Tier=2, work_mode=HYBRID, br_eligible=BR_OK (exact)
- **Entries 5-10 + 12 (7 Thermo geo-restricted)**: Tier=4 (exact); work_mode and br_eligible secondary

## Overall PASS criterion

PASS if **all 12 entries** meet their per-entry criterion. Single FAIL → overall FAIL.

Soft FAILs (Gupy enum-vs-live-JD divergence) reported but framed in handoff as architectural divergence, not v2-system bug — Vitor decides whether to accept PASS-with-caveats or hard FAIL.
