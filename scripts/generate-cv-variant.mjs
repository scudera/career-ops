#!/usr/bin/env node
// @ts-check
/**
 * generate-cv-variant — produce a tailored CV from master-profile.md
 *
 * Usage:
 *   node scripts/generate-cv-variant.mjs <master-profile.md> --variant=<eu|uk|ie|pt|br|us> [--output=<path>]
 *
 * Adapted from olegvg/resume-tailor-plugin (MIT). Filters roles by
 * Visibility schema:
 *   - always              → included
 *   - variant-specific    → included if target variant in role's Variants
 *   - on-request          → skipped (use --include-on-request to override)
 *   - reference-only      → never included
 *
 * The master profile is expected to be markdown with H3-level role
 * sections, each containing `- **Visibility:** <value>` and (optionally)
 * `- **Variants:** <comma-list>` metadata lines.
 */

import fs from 'node:fs';
import path from 'node:path';

const VALID_VISIBILITIES = new Set(['always', 'variant-specific', 'on-request', 'reference-only']);

function parseArgs(argv) {
  const out = { variant: '', output: '', includeOnRequest: false, inputPath: '' };
  for (const a of argv) {
    if (a.startsWith('--variant=')) out.variant = a.slice(10).trim().toLowerCase();
    else if (a.startsWith('--output=')) out.output = a.slice(9).trim();
    else if (a === '--include-on-request') out.includeOnRequest = true;
    else if (!a.startsWith('--')) out.inputPath = a;
  }
  return out;
}

function parseProfile(markdown) {
  const lines = markdown.split(/\r?\n/);
  /** @type {Array<{header: string, level: number, lines: string[], visibility: string|null, variants: string[]}>} */
  const sections = [];
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{2,4})\s+(.+)$/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = {
        header: line,
        level: headerMatch[1].length,
        lines: [],
        visibility: null,
        variants: [],
      };
      continue;
    }
    if (!current) {
      // Pre-section lines (title etc) — collect under a synthetic "preamble" section
      if (sections.length === 0) {
        sections.push({ header: '__preamble__', level: 0, lines: [line], visibility: 'always', variants: [] });
      } else {
        sections[sections.length - 1].lines.push(line);
      }
      continue;
    }
    current.lines.push(line);
    const visMatch = line.match(/^-\s+\*\*Visibility:\*\*\s+(\S+)/i);
    if (visMatch && VALID_VISIBILITIES.has(visMatch[1].toLowerCase())) {
      current.visibility = visMatch[1].toLowerCase();
    }
    const varMatch = line.match(/^-\s+\*\*Variants:\*\*\s+(.+)$/i);
    if (varMatch) {
      current.variants = varMatch[1].split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function shouldInclude(section, opts) {
  // Sections without explicit visibility default to 'always' (per source spec).
  const vis = section.visibility || 'always';
  if (vis === 'reference-only') return false;
  if (vis === 'always') return true;
  if (vis === 'on-request') return opts.includeOnRequest === true;
  if (vis === 'variant-specific') {
    return section.variants.includes(opts.variant);
  }
  return true;
}

function isStructuralSection(section) {
  // Structural sections (Contact, Visibility Schema, How to use) bypass
  // variant filtering — they are infrastructure, not role content.
  const headerText = section.header.toLowerCase();
  return (
    section.header === '__preamble__' ||
    headerText.includes('## contact') ||
    headerText.includes('visibility schema') ||
    headerText.includes('how to use') ||
    headerText.includes('career narrative') ||
    headerText.includes('notes')
  );
}

function render(sections, opts) {
  const out = [];
  let inStructural = false;
  for (const section of sections) {
    if (isStructuralSection(section)) {
      // Skip the master-profile-only sections from the variant output
      if (
        section.header.toLowerCase().includes('visibility schema') ||
        section.header.toLowerCase().includes('how to use') ||
        section.header.toLowerCase().includes('career narrative') ||
        section.header.toLowerCase().includes('notes')
      ) {
        continue;
      }
      // Keep preamble title + Contact
      if (section.header === '__preamble__') {
        out.push(`# CV — ${opts.variant.toUpperCase()} variant\n`);
        continue;
      }
      out.push(section.header);
      out.push(...section.lines);
      continue;
    }
    if (!shouldInclude(section, opts)) continue;
    out.push(section.header);
    // Strip Visibility/Variants meta lines from output (they're infra, not CV content)
    for (const line of section.lines) {
      if (/^-\s+\*\*Visibility:\*\*/i.test(line)) continue;
      if (/^-\s+\*\*Variants:\*\*/i.test(line)) continue;
      out.push(line);
    }
  }
  return out.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.inputPath || !opts.variant) {
    console.error('Usage: node scripts/generate-cv-variant.mjs <master-profile.md> --variant=<eu|uk|ie|pt|br|us> [--output=<path>] [--include-on-request]');
    process.exit(2);
  }
  if (!fs.existsSync(opts.inputPath)) {
    console.error(`Input not found: ${opts.inputPath}`);
    process.exit(1);
  }
  const md = fs.readFileSync(opts.inputPath, 'utf8');
  const sections = parseProfile(md);
  const stats = {
    total: sections.length,
    always: sections.filter((s) => (s.visibility || 'always') === 'always').length,
    variantSpecific: sections.filter((s) => s.visibility === 'variant-specific').length,
    onRequest: sections.filter((s) => s.visibility === 'on-request').length,
    referenceOnly: sections.filter((s) => s.visibility === 'reference-only').length,
    included: 0,
  };
  for (const s of sections) {
    if (isStructuralSection(s)) continue;
    if (shouldInclude(s, opts)) stats.included++;
  }
  const output = render(sections, opts);
  if (opts.output) {
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(opts.output, output);
    console.error(`Variant: ${opts.variant} → ${opts.output}`);
  } else {
    process.stdout.write(output);
  }
  console.error(`Sections: ${stats.total} (always=${stats.always}, variant-specific=${stats.variantSpecific}, on-request=${stats.onRequest}, reference-only=${stats.referenceOnly}). Included for variant '${opts.variant}': ${stats.included}.`);
}

main();
