#!/usr/bin/env node
// Unit tests for providers/teamtailor.mjs
// Tests the mapping logic (mapItem, extractLocation, detect) using sample data.
// Run: node test/test-teamtailor.mjs

import assert from 'node:assert/strict';
import { mapItem, extractLocation, default as provider } from '../providers/teamtailor.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// --- Sample data matching the real Medinfar feed shape ---

const SAMPLE_ITEM_REGULATORY = {
  id: '3c6b967f-cb7b-4223-bfcb-08a0c07745a2',
  title: 'Regulatory Affairs Technician',
  url: 'https://grupomedinfar.teamtailor.com/jobs/7702309-regulatory-affairs-technician',
  date_published: '2026-05-07T18:22:32+01:00',
  content_html: '<p>Na <strong>Medinfar</strong>...</p>',
  _jobposting: {
    '@context': 'http://schema.org/',
    '@type': 'JobPosting',
    title: 'Regulatory Affairs Technician',
    jobLocation: [
      {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'R. Henrique Paiva Couceiro 29',
          addressLocality: 'Amadora',
          postalCode: '2700-451',
          addressCountry: 'PT',
          addressRegion: 'Grande Lisboa',
        },
      },
    ],
  },
};

const SAMPLE_ITEM_QA = {
  id: '1425a8df-51e4-4f36-bfd9-97167f7f911a',
  title: 'Quality Assurance Supervisor - Validação processo',
  url: 'https://grupomedinfar.teamtailor.com/jobs/7437624-quality-assurance-supervisor-validacao-processo',
  date_published: '2026-03-20T15:11:18+00:00',
  content_html: '<p>Na Medinfar...</p>',
  _jobposting: {
    '@context': 'http://schema.org/',
    '@type': 'JobPosting',
    title: 'Quality Assurance Supervisor - Validação processo',
    jobLocation: [
      {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Parque Industrial...',
          addressLocality: 'Sebal',
          postalCode: '3150-194',
          addressCountry: 'PT',
          addressRegion: 'Coimbra',
        },
      },
    ],
  },
};

const SAMPLE_ITEM_NO_LOCATION = {
  id: 'abc123',
  title: 'Software Engineer',
  url: 'https://example.teamtailor.com/jobs/123-software-engineer',
  date_published: '2026-04-01T10:00:00+00:00',
  content_html: '<p>...</p>',
  // no _jobposting
};

const SAMPLE_ITEM_MISSING_FIELDS = {
  id: 'def456',
  title: '',
  url: '',
};

// --- extractLocation tests ---

console.log('\nextractLocation:');

test('extracts addressLocality + addressCountry from _jobposting', () => {
  const loc = extractLocation(SAMPLE_ITEM_REGULATORY);
  assert.equal(loc, 'Amadora, PT');
});

test('works with second item (Sebal, PT)', () => {
  const loc = extractLocation(SAMPLE_ITEM_QA);
  assert.equal(loc, 'Sebal, PT');
});

test('returns empty string when no _jobposting', () => {
  const loc = extractLocation(SAMPLE_ITEM_NO_LOCATION);
  assert.equal(loc, '');
});

test('returns empty string for null item', () => {
  assert.equal(extractLocation(null), '');
});

test('returns empty string when jobLocation is missing', () => {
  const item = { _jobposting: { '@type': 'JobPosting' } };
  assert.equal(extractLocation(item), '');
});

test('handles single object (non-array) jobLocation', () => {
  const item = {
    _jobposting: {
      jobLocation: {
        '@type': 'Place',
        address: { addressLocality: 'Lisbon', addressCountry: 'PT' },
      },
    },
  };
  assert.equal(extractLocation(item), 'Lisbon, PT');
});

// --- mapItem tests ---

console.log('\nmapItem:');

test('maps Regulatory Affairs item correctly', () => {
  const job = mapItem(SAMPLE_ITEM_REGULATORY, 'Medinfar');
  assert.equal(job.title, 'Regulatory Affairs Technician');
  assert.equal(job.url, 'https://grupomedinfar.teamtailor.com/jobs/7702309-regulatory-affairs-technician');
  assert.equal(job.company, 'Medinfar');
  assert.equal(job.location, 'Amadora, PT');
  assert.equal(job.posted_at, '2026-05-07');
});

test('maps QA Supervisor item correctly', () => {
  const job = mapItem(SAMPLE_ITEM_QA, 'Medinfar');
  assert.equal(job.title, 'Quality Assurance Supervisor - Validação processo');
  assert.equal(job.location, 'Sebal, PT');
  assert.equal(job.posted_at, '2026-03-20');
});

test('returns null for item missing title', () => {
  const job = mapItem(SAMPLE_ITEM_MISSING_FIELDS, 'Acme');
  assert.equal(job, null);
});

test('returns null for item missing url', () => {
  const job = mapItem({ title: 'Engineer', url: '' }, 'Acme');
  assert.equal(job, null);
});

test('maps item with no _jobposting (location empty, date still parsed)', () => {
  const job = mapItem(SAMPLE_ITEM_NO_LOCATION, 'Acme');
  assert.ok(job !== null);
  assert.equal(job.title, 'Software Engineer');
  assert.equal(job.location, '');
  // date_published exists in SAMPLE_ITEM_NO_LOCATION — it should still parse
  assert.equal(job.posted_at, '2026-04-01');
});

test('omits posted_at when date_published is absent', () => {
  const job = mapItem({ title: 'Analyst', url: 'https://x.teamtailor.com/jobs/1' }, 'Acme');
  assert.ok(job !== null);
  assert.equal(job.posted_at, undefined);
});

test('uses provided companyName not feed title', () => {
  const job = mapItem(SAMPLE_ITEM_REGULATORY, 'Grupo Medinfar Override');
  assert.equal(job.company, 'Grupo Medinfar Override');
});

// --- detect tests ---

console.log('\ndetect:');

test('detects *.teamtailor.com careers_url', () => {
  const hit = provider.detect({ name: 'Medinfar', careers_url: 'https://grupomedinfar.teamtailor.com' });
  assert.ok(hit !== null);
  assert.equal(hit.url, 'https://grupomedinfar.teamtailor.com/jobs.json');
});

test('detects *.teamtailor.com careers_url with /jobs path', () => {
  const hit = provider.detect({ name: 'Acme', careers_url: 'https://acme.teamtailor.com/jobs' });
  assert.ok(hit !== null);
  assert.equal(hit.url, 'https://acme.teamtailor.com/jobs.json');
});

test('returns null for non-teamtailor URL', () => {
  const hit = provider.detect({ name: 'Other', careers_url: 'https://jobs.lever.co/acme' });
  assert.equal(hit, null);
});

test('returns null when careers_url is absent', () => {
  const hit = provider.detect({ name: 'Empty' });
  assert.equal(hit, null);
});

test('returns null for empty string careers_url', () => {
  const hit = provider.detect({ name: 'Empty', careers_url: '' });
  assert.equal(hit, null);
});

// --- fetch via mock ctx ---

console.log('\nfetch (mock ctx):');

const MOCK_FEED = {
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Grupo Medinfar',
  items: [SAMPLE_ITEM_REGULATORY, SAMPLE_ITEM_QA],
};

const mockCtx = {
  transport: 'http',
  fetchText: async () => { throw new Error('not used'); },
  fetchJson: async (url) => {
    if (url === 'https://grupomedinfar.teamtailor.com/jobs.json') return MOCK_FEED;
    throw new Error(`unexpected URL: ${url}`);
  },
};

test('fetch returns mapped jobs array', async () => {
  const jobs = await provider.fetch(
    { name: 'Medinfar', careers_url: 'https://grupomedinfar.teamtailor.com' },
    mockCtx
  );
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Regulatory Affairs Technician');
  assert.equal(jobs[0].company, 'Medinfar');
  assert.equal(jobs[0].location, 'Amadora, PT');
  assert.equal(jobs[0].posted_at, '2026-05-07');
  assert.equal(jobs[1].title, 'Quality Assurance Supervisor - Validação processo');
});

test('fetch handles empty items array gracefully', async () => {
  const ctx = {
    transport: 'http',
    fetchText: async () => '',
    fetchJson: async () => ({ version: 'https://jsonfeed.org/version/1.1', title: 'Empty', items: [] }),
  };
  const jobs = await provider.fetch({ name: 'Empty', careers_url: 'https://empty.teamtailor.com' }, ctx);
  assert.equal(jobs.length, 0);
});

test('fetch throws when careers_url has no slug', async () => {
  await assert.rejects(
    () => provider.fetch({ name: 'Bad', careers_url: 'https://lever.co/bad' }, mockCtx),
    /teamtailor: cannot derive slug/
  );
});

test('fetch follows next_url pagination (JSON Feed 1.1)', async () => {
  const page1 = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Paged Co',
    next_url: 'https://pagedco.teamtailor.com/jobs.json?page=2',
    items: [SAMPLE_ITEM_REGULATORY],
  };
  const page2 = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Paged Co',
    items: [SAMPLE_ITEM_QA],
  };
  const pagedCtx = {
    transport: 'http',
    fetchText: async () => '',
    fetchJson: async (url) => {
      if (url === 'https://pagedco.teamtailor.com/jobs.json') return page1;
      if (url === 'https://pagedco.teamtailor.com/jobs.json?page=2') return page2;
      throw new Error(`unexpected URL: ${url}`);
    },
  };
  const jobs = await provider.fetch(
    { name: 'Paged Co', careers_url: 'https://pagedco.teamtailor.com' },
    pagedCtx
  );
  assert.equal(jobs.length, 2, 'should collect jobs from both pages');
  assert.equal(jobs[0].title, 'Regulatory Affairs Technician');
  assert.equal(jobs[1].title, 'Quality Assurance Supervisor - Validação processo');
});

// --- summary ---

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
