// @ts-check
/**
 * CDP apply automation — entry point.
 *
 * Architectural NOTES (read before using):
 *
 * 1. AUTO-SUBMIT IS THE DEFAULT (--review-pause=5).
 *    Fill form → upload CV → 5-second countdown (Ctrl-C to abort) → click Submit
 *    → audit screenshot. Failure-to-abort is irreversible (applies to real
 *    employer's tracker). Use --dry-run to test against a new ATS without
 *    submitting.
 *
 * 2. Fresh browser, NOT user's Chrome.
 *    Launches chromium.launch({ headless: false }). No login cookies, no
 *    session state. ATSes requiring login (some Workday flows, LinkedIn
 *    Easy Apply) will fail unless the form is anonymous. For login-walled
 *    ATSes, claude-apply's connectOverCDP pattern is needed — out of scope
 *    here.
 *
 * 3. Profile data source.
 *    Currently expects an inline `profile` object via the API. CLI mode reads
 *    a minimal profile from environment vars or argv; real use should pass
 *    a fully-populated profile (see field-classifier::mapProfileValue keys).
 *
 * @typedef {object} ApplyOptions
 * @property {string} url - Job posting URL
 * @property {string} cvPath - Path to CV file (PDF or markdown)
 * @property {object} [profile] - Profile data (see mapProfileValue keys)
 * @property {number} [reviewPause=5] - Seconds to pause before submit
 * @property {boolean} [dryRun=false] - If true, fill+upload but skip submit
 * @property {string} [company='unknown'] - For audit screenshot filename
 * @property {string} [role='unknown'] - For audit screenshot filename
 */

import { chromium } from 'playwright';
import { fillForm } from './form-filler.mjs';
import { uploadCv } from './cv-upload.mjs';
import { countdownGate } from './countdown-gate.mjs';
import { auditScreenshot } from './audit-screenshot.mjs';

const SUBMIT_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'button:has-text("Submit Application")',
  'button:has-text("Send Application")',
  'button:has-text("Submit")',
  'button:has-text("Apply Now")',
  'button:has-text("Apply")',
  'button:has-text("Send")',
  'input[type="submit"]',
];

/**
 * @param {ApplyOptions} opts
 */
export async function applyToJob(opts) {
  const {
    url,
    cvPath,
    profile = {},
    reviewPause = 5,
    dryRun = false,
    company = 'unknown',
    role = 'unknown',
  } = opts;

  if (!url || !cvPath) throw new Error('applyToJob: url and cvPath are required');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to:', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((err) => {
      console.warn('networkidle wait exceeded — continuing:', err?.message);
    });

    console.log('Filling form...');
    const fillResult = await fillForm(page, profile);
    console.log(
      `Fields visible: ${fillResult.fieldCount}, filled: ${fillResult.filled}, skipped: ${fillResult.skipped.length}`
    );
    if (fillResult.skipped.length > 0 && fillResult.skipped.length <= 8) {
      console.log('Skipped fields:');
      for (const s of fillResult.skipped) {
        console.log(`  - [${s.idx}] ${s.label}: ${s.reason}`);
      }
    }

    console.log('Uploading CV:', cvPath);
    const uploadResult = await uploadCv(page, cvPath);
    if (uploadResult.ok) {
      console.log(`CV uploaded to file input #${uploadResult.inputIndex} (label: ${uploadResult.label || 'none'})`);
    } else {
      console.warn('CV upload skipped:', uploadResult.reason);
    }

    if (dryRun) {
      console.log('--dry-run: skipping submit. Browser stays open for inspection.');
      console.log('Close browser manually when done.');
      // Don't close browser in dry-run; let user inspect
      return {
        submitted: false,
        dryRun: true,
        fillResult,
        uploadResult,
      };
    }

    await countdownGate(reviewPause);

    console.log('Clicking Submit...');
    let clicked = false;
    for (const sel of SUBMIT_BUTTON_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        const visible = await btn.isVisible({ timeout: 500 }).catch(() => false);
        if (visible) {
          await btn.click({ timeout: 3000 });
          clicked = true;
          console.log(`Submit clicked via: ${sel}`);
          break;
        }
      } catch {
        /* try next selector */
      }
    }
    if (!clicked) {
      console.error('Submit button not found via any selector. Aborting.');
      const screenshotPath = await auditScreenshot(page, { company: company + '-NO-SUBMIT', role });
      return { submitted: false, error: 'submit button not found', screenshotPath };
    }

    await page.waitForTimeout(4000);
    const screenshotPath = await auditScreenshot(page, { company, role });

    console.log('Submitted. Browser stays open — close manually after verification.');
    return { submitted: true, screenshotPath, fillResult, uploadResult };
  } catch (err) {
    console.error('apply error:', err?.message || err);
    try {
      await auditScreenshot(page, { company: company + '-ERROR', role });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// CLI mode
const isMain = (() => {
  try {
    const here = new URL(import.meta.url).pathname;
    const argv1 = String(process.argv[1] || '').replace(/\\/g, '/');
    return here.endsWith(argv1) || argv1.endsWith(here);
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith('http'));
  const cvPath = args.find((a) => a.startsWith('--cv='))?.slice(5);
  const reviewPauseArg = args.find((a) => a.startsWith('--review-pause='))?.slice(15);
  const reviewPause = reviewPauseArg !== undefined ? parseInt(reviewPauseArg, 10) : 5;
  const dryRun = args.includes('--dry-run');
  const company = args.find((a) => a.startsWith('--company='))?.slice(10) || 'unknown';
  const role = args.find((a) => a.startsWith('--role='))?.slice(7) || 'unknown';

  if (!url || !cvPath) {
    console.error('Usage: node src/apply/index.mjs <url> --cv=<path> [--review-pause=N] [--dry-run] [--company=X] [--role=Y]');
    console.error('Defaults: --review-pause=5 (Ctrl-C to abort during countdown)');
    console.error('Profile: pass via API call only — CLI uses minimal env-var profile (not implemented).');
    process.exit(1);
  }

  applyToJob({ url, cvPath, reviewPause, dryRun, company, role, profile: {} })
    .then((r) => console.log('Done:', JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
