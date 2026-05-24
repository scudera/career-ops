#!/usr/bin/env node
/**
 * backfill-story-bank.mjs — extract STAR stories from reports/*.md and append
 * to interview-prep/story-bank.md, deduped by normalized Situation hash.
 *
 * Scope: 67 STAR-format reports (Apr 17-24, 2026). Skips Overall Assessment
 * format (10 reports) and SKIP reports without Block F stories (30 reports).
 *
 * Format variants handled:
 *   A) Prose:    **História N — Title (Theme)** + > **S:** > **T:** > **A:** > **R:** > **Relevância:**
 *   B) Compact:  **N. Title** + - S: - T: - A: - R:
 *
 * Dedup: SHA1 hash of normalized Situation field (lowercase, collapse
 * whitespace, strip leading articles + company names). First occurrence wins;
 * tracks how many duplicates merged.
 *
 * Usage:
 *   node scripts/backfill-story-bank.mjs --dry-run   # print stats only
 *   node scripts/backfill-story-bank.mjs             # append to story-bank.md
 *
 * COHO-28. Idempotent: re-running detects already-appended stories and skips
 * via the same hash dedup against the existing bank.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');
const BANK_PATH = join(ROOT, 'interview-prep', 'story-bank.md');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Block F section extraction ────────────────────────────────────────────
function extractBlockF(md) {
  const lines = md.split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (start === -1 && /^## (Block |Bloco )?F[\s.:—\-)]/.test(l)) {
      start = i + 1;
      continue;
    }
    if (start !== -1 && /^## (Block |Bloco )?G[\s.:—\-)]/.test(l)) {
      end = i;
      break;
    }
  }
  if (start === -1) return null;
  return lines.slice(start, end).join('\n');
}

// ─── Story parsing (format A: **História N — Title** + > **X:**) ──────────
function parseFormatA(blockText) {
  const stories = [];
  const headerRe = /^\*\*(?:História|Story)\s+(\d+)\s*[—\-:]\s*([^\n]+?)\*\*/gm;
  return parseByHeaders(blockText, headerRe, 'A');
}

// ─── Story parsing (format B: **N. Title** + - S: ...) ─────────────────────
function parseFormatB(blockText) {
  const headerRe = /^\*\*(\d+)\.\s+([^\n]+?)\*\*\s*$/gm;
  return parseByHeaders(blockText, headerRe, 'B');
}

// ─── Story parsing (format C: ### Story N: Title + **S:** ...) ────────────
function parseFormatC(blockText) {
  // Match "### Story N: Title", "### Story N — Title", "### História N — Title"
  const headerRe = /^###\s+(?:Story|História|Historia)\s+(\d+)(?:\s*\([^)]*\))?\s*[—\-:]\s*([^\n]+?)\s*$/gm;
  return parseByHeaders(blockText, headerRe, 'C');
}

// ─── Story parsing (format D: full table | # | JD Req | Story | S | T | A | R | Reflection |) ─
function parseFormatD(blockText) {
  const stories = [];
  // Detect the table header
  const tableHeaderRe = /^\|\s*#\s*\|.*\bS\b.*\bT\b.*\bA\b.*\bR\b/m;
  if (!tableHeaderRe.test(blockText)) return [];
  const lines = blockText.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (tableHeaderRe.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  // Parse column order from header
  const cols = lines[headerIdx].split('|').map(c => c.trim()).filter(Boolean);
  const colIdx = name => cols.findIndex(c => new RegExp(`^${name}\\b`, 'i').test(c));
  const idxNum = colIdx('#');
  const idxStory = cols.findIndex(c => /Story|Histor/i.test(c));
  const idxJD = cols.findIndex(c => /JD Req|Requisito/i.test(c));
  const idxS = colIdx('S');
  const idxT = colIdx('T');
  const idxA = colIdx('A');
  const idxR = colIdx('R');
  const idxRefl = colIdx('Reflection') >= 0 ? colIdx('Reflection') : colIdx('Reflex');
  // Skip header and separator
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = line.split('|').map(c => c.trim()).filter((_, ix, arr) => ix > 0 && ix < arr.length - 1);
    if (cells.length < cols.length - 1) continue;
    const S = idxS >= 0 ? cells[idxS] : '';
    if (!S) continue;
    const rawTitle = idxStory >= 0 ? cells[idxStory] : (idxJD >= 0 ? cells[idxJD] : `Story ${cells[idxNum] || i}`);
    const theme = inferTheme(rawTitle);
    stories.push({
      title: rawTitle,
      theme,
      format: 'D',
      S,
      T: idxT >= 0 ? cells[idxT] : null,
      A: idxA >= 0 ? cells[idxA] : null,
      R: idxR >= 0 ? cells[idxR] : null,
      reflection: idxRefl >= 0 ? cells[idxRefl] : null,
    });
  }
  return stories;
}

function parseByHeaders(blockText, headerRe, format) {
  const stories = [];
  const headers = [];
  let m;
  while ((m = headerRe.exec(blockText)) !== null) {
    headers.push({ idx: m.index, num: m[1], rawTitle: m[2].trim() });
  }
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].idx;
    const end = i + 1 < headers.length ? headers[i + 1].idx : blockText.length;
    const body = blockText.slice(start, end);
    const story = parseSTARBody(body, headers[i].rawTitle, format);
    if (story) stories.push(story);
  }
  return stories;
}

// ─── STAR/Relevância field extraction (both formats) ──────────────────────
function parseSTARBody(body, rawTitle, format) {
  // Field markers accept either single-letter (S/T/A/R) or full words
  // (Situation/Task/Action/Result), with optional bold/blockquote/bullet prefix
  // and optional `(parenthetical)` after the marker.
  const F = '(Situation|Task|Action|Result|Reflection|Reflex[ãa]o|Relev[âa]ncia|Relevance|Relevancia|S|T|A|R)';
  // Marker prefix can be **bold**, *italic*, > blockquote, - bullet, or
  // combinations thereof. Trailing colon may sit inside or outside the wrap.
  const PFX = '(?:>\\s*\\*\\*|>\\s*\\*|-\\s*\\*\\*|-\\s*\\*|\\*\\*|\\*|>\\s*|-\\s+)';
  const fieldRe = new RegExp(
    `(?:^|\\n)\\s*${PFX}${F}(?:\\s*\\([^)]*\\))?\\s*:\\*?\\*?\\s*([\\s\\S]*?)(?=\\n\\s*${PFX}${F}(?:\\s*\\([^)]*\\))?\\s*:|\\n##|\\n---|\\n\\*\\*[A-Za-zÀ-ÿ]|$)`,
    'gi'
  );
  const fields = {};
  let m;
  while ((m = fieldRe.exec(body)) !== null) {
    let key = m[1].toUpperCase();
    // Normalize full words to single-letter
    if (key.startsWith('SITUAT')) key = 'S';
    else if (key.startsWith('TASK')) key = 'T';
    else if (key.startsWith('ACTION')) key = 'A';
    else if (key.startsWith('RESULT')) key = 'R';
    const val = m[2]
      .replace(/^\s*>\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (val) fields[key] = val;
  }
  if (!fields.S) return null;
  // Theme/title parsing — pattern "Title (Theme)" or just "Title"
  const themeMatch = rawTitle.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const title = themeMatch ? themeMatch[1].trim() : rawTitle;
  const theme = themeMatch ? themeMatch[2].trim() : inferTheme(title);
  return {
    title,
    theme,
    format,
    S: fields.S,
    T: fields.T || null,
    A: fields.A || null,
    R: fields.R || null,
    reflection: fields.REFLECTION || fields.REFLEXÃO || fields['RELEVÂNCIA'] || fields.RELEVANCE || fields.RELEVANCIA || null,
  };
}

function inferTheme(title) {
  const t = title.toLowerCase();
  if (/(strateg|estrateg|regional|latam)/i.test(t)) return 'Regulatory Strategy';
  if (/(secondment|global|international|internacional)/i.test(t)) return 'International Regulatory';
  if (/(submiss|dossier|dossiê|cmc|labeling)/i.test(t)) return 'Regulatory Operations';
  if (/(intelligence|horizon|gap analy|scanning)/i.test(t)) return 'Regulatory Intelligence';
  if (/(crisis|crise|inspe[çc]|auditoria|emergency)/i.test(t)) return 'Crisis Management';
  if (/(due diligence|m&a|business)/i.test(t)) return 'Cross-functional';
  if (/(team|lideranç|leader|mentor)/i.test(t)) return 'Leadership';
  if (/(saas|empreend|exit|gap|narrative)/i.test(t)) return 'Exit Narrative';
  return 'General';
}

// ─── Dedup hash ────────────────────────────────────────────────────────────
function situationHash(s) {
  const normalized = s
    .toLowerCase()
    .replace(/\b(pfizer|viatris|upjohn|novartis|sanofi|takeda|amgen|gsk|astrazeneca|chiesi|eurofarma|sandoz|brainfarma|libbs|icon|iqvia|parexel|abbvie|moderna|labcorp|veeva|roche|msd|merck|eli lilly|lilly|johnson|janssen|bayer|boehringer|hypera|cristália|cristalia|mcassab|thermo|biogen|gilead|elanco|amgen|farma vision)\b/g, 'CO')
    .replace(/\b\d{4}[\-–—]\d{4}\b/g, 'YEARS')
    .replace(/\b\d+\b/g, 'N')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Tighter dedup: hash on first 8 significant words after stopword filter
  // (catches "same lived experience, varying wording" pattern — e.g. the
  // secondment / LATAM portfolio / GMP-China stories repeated 30+ times across
  // reports with slight rephrasing).
  const stopwords = /^(the|a|an|and|or|but|of|in|on|at|to|for|with|by|from|as|is|was|were|are|be|been|being|that|which|who|this|these|those|it|its|i|we|our|my|me|you|your|he|she|they|them|their|um|uma|de|da|do|das|dos|para|por|com|sem|em|no|na|nos|nas|que|um|uma|e|ou|mas|se|foi|era|ser|sido|este|esta|isto|esse|essa|isso|seu|sua|meu|minha|nosso|nossa|n)$/;
  const words = normalized.split(/\s+/).filter(w => w && !stopwords.test(w)).slice(0, 8);
  return createHash('sha1').update(words.join(' ')).digest('hex').slice(0, 12);
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const reportFiles = readdirSync(REPORTS_DIR)
    .filter(f => /^\d{3}-.+\.md$/.test(f))
    .sort();
  console.log(`📁 Reports dir: ${REPORTS_DIR}`);
  console.log(`📊 Total reports: ${reportFiles.length}`);

  let parseAttempts = 0;
  let parseSuccesses = 0;
  let parseFailures = [];
  const allStories = [];

  for (const f of reportFiles) {
    const full = join(REPORTS_DIR, f);
    const md = readFileSync(full, 'utf-8');
    if (!/STAR/.test(md)) continue;
    parseAttempts++;
    const blockF = extractBlockF(md);
    if (!blockF) {
      parseFailures.push({ file: f, reason: 'no Block F section' });
      continue;
    }
    const reportNum = (f.match(/^(\d{3})/) || [])[1] || '???';
    const slug = f.replace(/^\d{3}-/, '').replace(/-\d{4}-\d{2}-\d{2}\.md$/, '');
    const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : null;
    const storiesA = parseFormatA(blockF);
    const storiesB = parseFormatB(blockF);
    const storiesC = parseFormatC(blockF);
    const storiesD = parseFormatD(blockF);
    const stories = [...storiesA, ...storiesB, ...storiesC, ...storiesD];
    if (stories.length === 0) {
      parseFailures.push({ file: f, reason: 'no parseable stories in Block F' });
      continue;
    }
    parseSuccesses++;
    for (const s of stories) {
      allStories.push({
        ...s,
        sourceReport: reportNum,
        sourceFile: f,
        sourceSlug: slug,
        sourceDate: date,
        hash: situationHash(s.S),
      });
    }
  }

  // Dedup against existing bank if present
  let existingHashes = new Set();
  if (existsSync(BANK_PATH)) {
    const existingBank = readFileSync(BANK_PATH, 'utf-8');
    const existingSitRe = /\*\*S \(Situation\):\*\*\s*([^\n]+)/g;
    let m;
    while ((m = existingSitRe.exec(existingBank)) !== null) {
      existingHashes.add(situationHash(m[1]));
    }
  }

  const seen = new Map();
  let dupesInReports = 0;
  let dupesInBank = 0;
  const unique = [];
  for (const s of allStories) {
    if (existingHashes.has(s.hash)) {
      dupesInBank++;
      continue;
    }
    if (seen.has(s.hash)) {
      dupesInReports++;
      // Keep the one with the most complete reflection field
      const existing = seen.get(s.hash);
      if ((s.reflection?.length || 0) > (existing.reflection?.length || 0)) {
        const idx = unique.indexOf(existing);
        unique[idx] = s;
        seen.set(s.hash, s);
      }
      continue;
    }
    seen.set(s.hash, s);
    unique.push(s);
  }

  console.log(`\n📈 Parse stats:`);
  console.log(`   Reports w/ "STAR" string: ${parseAttempts}`);
  console.log(`   Reports parsed successfully: ${parseSuccesses}`);
  console.log(`   Reports failed: ${parseFailures.length}`);
  console.log(`   Stories extracted: ${allStories.length}`);
  console.log(`   Duplicates merged (across reports): ${dupesInReports}`);
  console.log(`   Duplicates already in bank: ${dupesInBank}`);
  console.log(`   Final unique stories: ${unique.length}`);
  console.log(`\n📋 Parse failures:`);
  for (const p of parseFailures.slice(0, 15)) {
    console.log(`   - ${p.file}: ${p.reason}`);
  }
  if (parseFailures.length > 15) console.log(`   ... +${parseFailures.length - 15} more`);

  // Group unique stories by theme for readable output
  const byTheme = {};
  for (const s of unique) {
    (byTheme[s.theme] = byTheme[s.theme] || []).push(s);
  }

  let appendMd = '\n';
  appendMd += `<!-- ─── Backfill from 67 reports — COHO-28 (${new Date().toISOString().slice(0, 10)}) ─── -->\n`;
  appendMd += `<!-- ${unique.length} unique stories extracted from ${parseSuccesses} reports; ${dupesInReports} duplicates merged by normalized Situation hash. -->\n\n`;
  for (const theme of Object.keys(byTheme).sort()) {
    appendMd += `\n## Theme: ${theme}\n\n`;
    for (const s of byTheme[theme]) {
      appendMd += `### [${s.theme}] ${s.title}\n`;
      appendMd += `**Source:** Report #${s.sourceReport} — ${s.sourceSlug} (${s.sourceDate})\n`;
      appendMd += `**S (Situation):** ${s.S}\n`;
      if (s.T) appendMd += `**T (Task):** ${s.T}\n`;
      if (s.A) appendMd += `**A (Action):** ${s.A}\n`;
      if (s.R) appendMd += `**R (Result):** ${s.R}\n`;
      if (s.reflection) appendMd += `**Reflection:** ${s.reflection}\n`;
      appendMd += `\n---\n\n`;
    }
  }

  if (DRY_RUN) {
    console.log(`\n📝 DRY-RUN — first 80 lines of would-append content:\n`);
    console.log(appendMd.split('\n').slice(0, 80).join('\n'));
    console.log(`\n   (Total would-append: ${appendMd.split('\n').length} lines, ${unique.length} stories)`);
    return { unique: unique.length, parseAttempts, parseSuccesses, parseFailures: parseFailures.length, dupesInReports, dupesInBank };
  }

  const existing = readFileSync(BANK_PATH, 'utf-8');
  writeFileSync(BANK_PATH, existing + appendMd, 'utf-8');
  console.log(`\n✅ Appended ${unique.length} stories to ${BANK_PATH}`);
  return { unique: unique.length, parseAttempts, parseSuccesses, parseFailures: parseFailures.length, dupesInReports, dupesInBank };
}

main();
