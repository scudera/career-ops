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
