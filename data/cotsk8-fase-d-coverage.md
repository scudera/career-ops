
## Fase D Coverage Smoke — 10 enabled Gupy tenants

[gupy] tenant="Brainfarma" path=api items=75 mapped=75
[gupy] tenant="Eurofarma" path=api items=48 mapped=48
[gupy] tenant="Hypera Pharma" path=api items=68 mapped=68
[gupy] tenant="Cristália" path=next-data items=33 mapped=33
[gupy] tenant="Libbs Farmacêutica" path=api items=26 mapped=26
[gupy] tenant="Prati-Donaduzzi" path=api items=37 mapped=37
[gupy] tenant="Daiichi Sankyo Brasil" path=next-data items=12 mapped=12
[gupy] tenant="ALS Life Sciences" path=next-data items=48 mapped=48
[gupy] tenant="Ourofino Saúde Animal" path=api items=15 mapped=15
[gupy] tenant="MCassab Nutrição e Saúde Animal" path=api items=11 mapped=11
| tenant | total | employment_type | posted_at | elapsed |
|--------|-------|-----------------|-----------|---------|
| Brainfarma (Gupy) | 75 | 65/75 (87%) | 75/75 (100%) | 2082ms |
| Eurofarma (Gupy) | 48 | 36/48 (75%) | 48/48 (100%) | 182ms |
| Hypera Pharma (Gupy) | 68 | 64/68 (94%) | 68/68 (100%) | 191ms |
| Cristália (Gupy) | 33 | 29/33 (88%) | 0/33 (0%) | 649ms |
| Libbs Farmacêutica (Gupy) | 26 | 24/26 (92%) | 26/26 (100%) | 173ms |
| Prati-Donaduzzi (Gupy) | 37 | 27/37 (73%) | 37/37 (100%) | 176ms |
| Daiichi Sankyo Brasil (Gupy) | 12 | 8/12 (67%) | 0/12 (0%) | 782ms |
| ALS Life Sciences (Gupy) | 48 | 45/48 (94%) | 0/48 (0%) | 787ms |
| Ourofino Saúde Animal (Gupy) | 15 | 13/15 (87%) | 15/15 (100%) | 167ms |
| MCassab Nutrição e Saúde Animal (Gupy) | 11 | 8/11 (73%) | 11/11 (100%) | 169ms |

### Aggregate

- Tenants on API path:       7/10
- Tenants on NEXT_DATA path: 3/10
- Total jobs:                373
- employment_type coverage:  319/373 (86%)
- posted_at coverage:        280/373 (75%) — BEFORE was 0%

### Delta vs BEFORE (NEXT_DATA only)

- posted_at:        0% → 75%  (+75pp)
- employment_type:  unchanged (both paths populate)
