#!/usr/bin/env node
// Tests for buildTitleFilter — word-boundary matching for RA-abbreviation recall
// without substring false positives (COTSK sourcing, Phase 1).
import { buildTitleFilter } from '../scan.mjs';

let passed = 0, failed = 0;
const failures = [];
function check(name, got, want) {
  if (got === want) { console.log(`  PASS  ${name}`); passed++; }
  else { console.log(`  FAIL  ${name} — got ${got}, want ${want}`); failed++; failures.push(name); }
}

const filter = buildTitleFilter({
  positive: ['Regulatory Affairs', 'RA Manager', 'RA CMC', 'Analista Regulatório', 'CMC Regulatory'],
  negative: ['(US)', 'Software', 'Medical Affairs'],
});

// Recall — phrases and abbreviations both match as whole tokens
check('phrase: Regulatory Affairs', filter('Senior Regulatory Affairs Specialist'), true);
check('abbrev: RA Manager', filter('RA Manager, Oncology'), true);
check('abbrev: RA CMC', filter('Global RA CMC Lead'), true);
check('accent: Analista Regulatório', filter('Analista Regulatório Sênior'), true);

// Precision — abbreviation must NOT match mid-word (the substring bug)
check('precision: Camera Manager not RA', filter('Camera Manager'), false);
check('precision: Ultra Manager not RA', filter('Ultra Manager'), false);
check('precision: Laboratory not RA', filter('Laboratory Technician'), false);

// Negatives still suppress (word-boundary safe, punctuation preserved)
check('negative: (US) suppresses', filter('Regulatory Affairs (US)'), false);
check('negative: Software suppresses', filter('Regulatory Affairs Software Engineer'), false);
check('negative: Medical Affairs suppresses', filter('Medical Affairs Manager'), false);
check('boundary: Aarhus RA passes', filter('Regulatory Affairs, Aarhus'), true);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:', failures.join(', ')); process.exit(1); }
