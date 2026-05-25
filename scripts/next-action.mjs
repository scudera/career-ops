#!/usr/bin/env node
// @ts-check
//
// next-action.mjs — single next-action surfacer for career-ops.
//
// Diagnostic (advisor + Vitor, 2026-05-25): the failure mode is not discovery,
// it's apply-velocity. Top scored vagas get evaluated then sit unseen in an
// 80-row tracker until they expire. This script generates ONE concrete
// action per day: the highest-scoring still-active candidate + its deadline
// + apply/discard CTAs.
//
// Inputs:
//   - data/applications.md (canonical tracker, Vitor edits Status via dashboard)
//   - reports/{NNN}-*.md (per-vaga full reports with URL + Machine Summary)
//
// Output:
//   - data/NEXT_ACTION.md (single page, copy-friendly, opens in any markdown viewer)
//
// Logic:
//   1. Read applications.md, parse rows
//   2. Filter: Status == Evaluated AND score >= MIN_SCORE (default 3.6)
//   3. For each, read report -> extract URL, posted_at, archetype
//   4. Rank by score DESC, then by recency DESC
//   5. Compute estimated deadline = posted_at + DEADLINE_WEEKS
//   6. Emit primary action (#1) + backup queue (#2-3) + clear CTAs
//
// Run: node scripts/next-action.mjs
//
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const APPS_PATH = 'data/applications.md';
const REPORTS_DIR = 'reports';
const OUT_PATH = 'data/NEXT_ACTION.md';
const MIN_SCORE = 3.6;
const DEADLINE_WEEKS = 6;

if (!existsSync(APPS_PATH)) {
  console.error(`[next-action] FATAL: ${APPS_PATH} not found`);
  process.exit(1);
}

const URL_REGEX = /^\*\*URL:\*\*\s+(https?:\/\/\S+)/m;
const YAML_BLOCK_REGEX = /## Machine Summary\s*\n+```yaml\s*\n([\s\S]+?)\n```/;
const HEADER_SCORE_REGEX = /^\*\*Score:\*\*\s+(\d+(?:\.\d+)?)/m;

function parseApplications() {
  const text = readFileSync(APPS_PATH, 'utf-8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 10) continue;
    const num = cells[1];
    if (!/^\d+$/.test(num)) continue;
    const score = parseFloat(cells[5]);
    if (!Number.isFinite(score)) continue;
    rows.push({
      num,
      date: cells[2],
      company: cells[3],
      role: cells[4],
      score,
      status: cells[6],
      pdf: cells[7],
      reportLink: cells[8],
      notes: cells[9],
    });
  }
  return rows;
}

function reportPath(num) {
  // reports/{NNN}-*.md, pad num to 3 digits
  const padded = num.padStart(3, '0');
  try {
    const files = readdirSync(REPORTS_DIR);
    const match = files.find(f => f.startsWith(`${padded}-`) && f.endsWith('.md'));
    return match ? join(REPORTS_DIR, match) : null;
  } catch (_err) {
    return null;
  }
}

function enrichFromReport(row) {
  const p = reportPath(row.num);
  if (!p) return row;
  const text = readFileSync(p, 'utf-8');
  const url = (text.match(URL_REGEX) || [])[1] || null;
  let archetype = null;
  let postedAt = null;
  const yMatch = text.match(YAML_BLOCK_REGEX);
  if (yMatch) {
    try {
      const parsed = yaml.load(yMatch[1]);
      if (parsed && typeof parsed === 'object') {
        archetype = parsed.archetype || null;
        postedAt = parsed.posted_at || null;
      }
    } catch (_err) {}
  }
  // Fallback: posted_at often equals row.date (evaluation date) for batch-evaluated jobs.
  if (!postedAt) postedAt = row.date;
  return { ...row, url, archetype, postedAt, reportPath: p };
}

function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function addWeeks(dateStr, weeks) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function ageLabel(postedAt, today) {
  const d = daysBetween(postedAt, today);
  if (d < 0) return 'na data';
  if (d === 0) return 'hoje';
  if (d < 7) return `${d} dia${d === 1 ? '' : 's'} atrás`;
  const w = Math.floor(d / 7);
  return `${w} semana${w === 1 ? '' : 's'} atrás`;
}

function deadlineLabel(deadlineDate, today) {
  const d = daysBetween(today, deadlineDate);
  if (d < 0) return `EXPIRADA estimada há ${-d} dia${-d === 1 ? '' : 's'} — verifica liveness antes de aplicar`;
  if (d === 0) return 'EXPIRA HOJE (estimativa) — corre';
  if (d < 7) return `${d} dia${d === 1 ? '' : 's'} restante${d === 1 ? '' : 's'} (estimativa)`;
  const w = Math.floor(d / 7);
  return `~${w} semana${w === 1 ? '' : 's'} restante${w === 1 ? '' : 's'} (estimativa)`;
}

function formatPrimary(r, today) {
  const deadline = addWeeks(r.postedAt, DEADLINE_WEEKS);
  const lines = [
    '## 🎯 Tua próxima ação',
    '',
    `**#${r.num} ${r.company} — ${r.role}** (${r.score}/5)`,
    '',
    `- **URL:** ${r.url || '(faltando no report — confere)'}`,
    `- **Archetype:** ${r.archetype || '(não capturado)'}`,
    `- **Posted/Eval:** ${r.postedAt} (${ageLabel(r.postedAt, today)})`,
    `- **Deadline estimado:** ${deadline} — ${deadlineLabel(deadline, today)}`,
    `- **Report:** ${r.reportLink}`,
    '',
    '### O que fazer agora (escolhe UMA):',
    '',
    `1. **Aplicar** → abre URL acima em incógnita, valida liveness, preenche form. Depois marca status \`Applied\` no dashboard (\`npm run dash\` → seleciona #${r.num} → \`c\` → Applied).`,
    `2. **Pular explicitamente** → dashboard → seleciona #${r.num} → \`c\` → \`Discarded\` (anota motivo). Amanhã sistema escolhe a próxima.`,
    '',
    'Sem terceira opção. "Vou ver depois" = falha silenciosa (padrão histórico: vaga expira sem ação).',
    '',
  ];
  return lines.join('\n');
}

function formatBackup(rows, today) {
  if (rows.length === 0) return '';
  const lines = ['## Backup queue (se a primária estiver morta ou irrelevante)', ''];
  for (const r of rows) {
    const deadline = addWeeks(r.postedAt, DEADLINE_WEEKS);
    const ageL = ageLabel(r.postedAt, today);
    const deadL = deadlineLabel(deadline, today);
    lines.push(`- **#${r.num} ${r.company} — ${r.role}** (${r.score}/5) | posted ${ageL} | deadline ${deadL} | ${r.reportLink}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatEmpty(today) {
  return [
    '# Next Action — ' + today,
    '',
    `## ⚪ Sem candidato ativo hoje (score ≥ ${MIN_SCORE} + Status=Evaluated)`,
    '',
    'Possibilidades:',
    `- Todas as vagas ≥${MIN_SCORE} já foram processadas (Applied/Discarded/Rejected). Aguarda próximo scan (cron amanhã 6am BRT).`,
    '- Score threshold tá alto demais pro pool atual. Considere abaixar `MIN_SCORE` em scripts/next-action.mjs se quer ver candidatos 3.0–3.5.',
    '',
    'Não invente trabalho. Sem APPLY hoje é signal estrutural, não falha do sistema.',
    '',
  ].join('\n');
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = parseApplications();
  const candidates = rows
    .filter(r => r.status === 'Evaluated' && r.score >= MIN_SCORE)
    .map(enrichFromReport)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.postedAt || '').localeCompare(a.postedAt || '');
    });

  let out;
  if (candidates.length === 0) {
    out = formatEmpty(today);
  } else {
    const [primary, ...rest] = candidates;
    const backup = rest.slice(0, 3);
    out = [
      `# Next Action — ${today}`,
      '',
      formatPrimary(primary, today),
      formatBackup(backup, today),
      `---`,
      `_Gerado por scripts/next-action.mjs. Lê data/applications.md. Re-rode quando atualizar status._`,
      '',
    ].join('\n');
  }

  writeFileSync(OUT_PATH, out);
  console.error(`[next-action] wrote ${OUT_PATH}`);
  console.error(`[next-action] candidates: ${candidates.length} (score >= ${MIN_SCORE} AND Status == Evaluated)`);
  if (candidates.length > 0) {
    console.error(`[next-action] primary: #${candidates[0].num} ${candidates[0].company} (${candidates[0].score}/5)`);
  }
}

main();
