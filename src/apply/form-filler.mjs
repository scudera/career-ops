// @ts-check
/**
 * form-filler — iterate visible form inputs, classify each, fill from profile.
 *
 * NEW file for career-ops (not in claude-apply source — which uses a
 * different per-ATS flow). Uses field-classifier from claude-apply for
 * label-based categorization.
 *
 * Inputs:
 *   page (Playwright Page) — fresh browser context, JD page loaded
 *   profile (object) — keys per field-classifier::mapProfileValue
 *
 * Output: { fieldCount, classified: {key: N}, filled: N, skipped: [...] }
 */

import { classifyField, mapProfileValue } from './field-classifier.mjs';

/**
 * Scrape visible form fields with their associated labels.
 * @param {import('playwright').Page} page
 */
async function collectFields(page) {
  return page.evaluate(() => {
    function labelFor(el) {
      // 1. <label for="id">
      if (el.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicit?.innerText) return explicit.innerText.trim();
      }
      // 2. wrapping <label>...<input/></label>
      const wrapped = el.closest('label');
      if (wrapped?.innerText) return wrapped.innerText.trim();
      // 3. aria-label / aria-labelledby
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();
      const ariaBy = el.getAttribute('aria-labelledby');
      if (ariaBy) {
        const ref = document.getElementById(ariaBy);
        if (ref?.innerText) return ref.innerText.trim();
      }
      // 4. placeholder
      const ph = el.getAttribute('placeholder');
      if (ph) return ph.trim();
      // 5. previous sibling text node
      const prev = el.previousElementSibling;
      if (prev?.innerText) return prev.innerText.trim();
      return '';
    }

    const selectors = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select';
    const nodes = Array.from(document.querySelectorAll(selectors));
    return nodes.map((el, idx) => {
      const style = window.getComputedStyle(el);
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        el.getClientRects().length > 0;
      return {
        idx,
        type: (el.type || el.tagName).toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        label: labelFor(el),
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        visible,
      };
    });
  });
}

/**
 * Fill a single field by index, given the classified value.
 * @param {import('playwright').Page} page
 * @param {number} idx
 * @param {string} value
 */
async function fillFieldByIndex(page, idx, value) {
  return page.evaluate(
    ({ idx, value }) => {
      const selectors = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select';
      const nodes = Array.from(document.querySelectorAll(selectors));
      const el = nodes[idx];
      if (!el) return { filled: false, reason: 'index out of range' };

      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();

      // React-safe setter for inputs/textareas
      function setReactValue(target, val) {
        const proto = Object.getPrototypeOf(target);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) {
          desc.set.call(target, val);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          target.value = val;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if (tag === 'select') {
        const target = String(value).toLowerCase();
        const option = Array.from(el.options).find(
          (o) => o.value.toLowerCase() === target || o.text.toLowerCase() === target
        );
        if (option) {
          el.value = option.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { filled: true };
        }
        return { filled: false, reason: `select option not found: ${value}` };
      }

      if (type === 'checkbox' || type === 'radio') {
        const target = String(value).toLowerCase();
        if (target === 'true' || target === 'yes' || target === '1') {
          if (!el.checked) {
            el.click();
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { filled: true };
        }
        return { filled: false, reason: `checkbox/radio value not boolean-like: ${value}` };
      }

      if (type === 'file') {
        // File inputs handled separately by cv-upload.mjs
        return { filled: false, reason: 'file input — handled by uploadCv()' };
      }

      setReactValue(el, String(value));
      return { filled: true };
    },
    { idx, value }
  );
}

/**
 * Fill all classifiable form fields on the page.
 * @param {import('playwright').Page} page
 * @param {object} profile — see field-classifier::mapProfileValue keys
 * @returns {Promise<{fieldCount: number, classified: Record<string, number>, filled: number, skipped: Array<{idx: number, label: string, reason: string}>}>}
 */
export async function fillForm(page, profile = {}) {
  const fields = await collectFields(page);
  const visible = fields.filter((f) => f.visible);

  const classified = {};
  const skipped = [];
  let filled = 0;

  for (const field of visible) {
    const key = classifyField(field);
    classified[key] = (classified[key] || 0) + 1;

    if (key === 'unknown') {
      skipped.push({ idx: field.idx, label: field.label, reason: 'no classifier match' });
      continue;
    }

    // File uploads are handled separately
    if (key.endsWith('_upload')) continue;

    const value = mapProfileValue(key, profile);
    if (value === undefined || value === null || value === '') {
      skipped.push({ idx: field.idx, label: field.label, reason: `profile has no value for ${key}` });
      continue;
    }

    const result = await fillFieldByIndex(page, field.idx, value);
    if (result?.filled) {
      filled++;
    } else {
      skipped.push({ idx: field.idx, label: field.label, reason: result?.reason || 'fill failed' });
    }
  }

  return { fieldCount: visible.length, classified, filled, skipped };
}
