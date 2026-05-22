// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * Save a post-submit (or error-state) screenshot for audit trail.
 * Mandatory in the CDP apply flow — auto-submit policy requires
 * a verifiable record of what was submitted.
 *
 * Path: data/applications/<ts>-<company>-<role>.png
 *
 * @param {import('playwright').Page} page
 * @param {{company: string, role: string}} meta
 * @returns {Promise<string>} Saved screenshot path, or '' on failure.
 */
export async function auditScreenshot(page, meta) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = (s) =>
    String(s || 'unknown')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'unknown';
  const fname = `${ts}-${safe(meta.company)}-${safe(meta.role)}.png`;
  const dir = path.resolve(process.cwd(), 'data', 'applications');
  fs.mkdirSync(dir, { recursive: true });
  const fpath = path.join(dir, fname);

  try {
    await page.screenshot({ path: fpath, fullPage: true });
    console.log('Audit screenshot saved:', fpath);
    return fpath;
  } catch (err) {
    console.error('Screenshot failed:', err?.message || err);
    return '';
  }
}
