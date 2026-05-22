// @ts-check
/**
 * cv-upload — find file input(s) on page, upload CV via Playwright setInputFiles.
 *
 * Adapted from LeoLaborie/claude-apply (MIT) src/apply/upload-file.mjs —
 * SIMPLIFIED to use Playwright's standard setInputFiles (fresh-browser model)
 * instead of connectOverCDP (existing-Chrome model). Source's CDP attach was
 * needed because the user's Chrome already had the form open; here we launch
 * fresh, so direct setInputFiles works.
 *
 * Strategy: locate the cv-classified file input via field-classifier rules,
 * fall back to first visible file input if classifier returns nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { classifyField } from './field-classifier.mjs';

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{idx:number, label:string, name:string, id:string, key:string}>>}
 */
async function findFileInputs(page) {
  const raw = await page.evaluate(() => {
    function labelFor(el) {
      if (el.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicit?.innerText) return explicit.innerText.trim();
      }
      const wrapped = el.closest('label');
      if (wrapped?.innerText) return wrapped.innerText.trim();
      return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }
    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
    return inputs.map((el, idx) => {
      const style = window.getComputedStyle(el);
      // Note: file inputs are often hidden visually but functionally available — accept hidden ones too
      return {
        idx,
        type: 'file',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        label: labelFor(el),
        hidden: style.display === 'none' || style.visibility === 'hidden',
      };
    });
  });
  return raw.map((f) => ({ ...f, key: classifyField(f) }));
}

/**
 * Upload a CV file. Picks cv_upload classified input first; falls back to
 * first file input if classifier finds nothing.
 *
 * @param {import('playwright').Page} page
 * @param {string} cvPath — absolute or relative path to CV file
 * @returns {Promise<{ok: boolean, reason?: string, inputIndex?: number, label?: string}>}
 */
export async function uploadCv(page, cvPath) {
  if (!cvPath) return { ok: false, reason: 'cvPath is empty' };
  const absPath = path.isAbsolute(cvPath) ? cvPath : path.resolve(process.cwd(), cvPath);
  if (!fs.existsSync(absPath)) {
    return { ok: false, reason: `CV file not found: ${absPath}` };
  }

  const inputs = await findFileInputs(page);
  if (inputs.length === 0) {
    return { ok: false, reason: 'no file inputs on page' };
  }

  // Prefer cv_upload classification; fall back to first file input
  const target = inputs.find((i) => i.key === 'cv_upload') || inputs[0];

  try {
    const handle = page.locator('input[type=file]').nth(target.idx);
    await handle.setInputFiles(absPath);
    return { ok: true, inputIndex: target.idx, label: target.label };
  } catch (err) {
    return { ok: false, reason: `setInputFiles failed: ${err?.message || err}` };
  }
}
