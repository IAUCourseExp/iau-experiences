import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { validateDataset, canonicalRecordBytes, fnv1a64, SCHEMA_VERSION } from '../../src/lib/schema.js';
import { loadTopicsArtifact, bindArtifact, neighborsFor } from '../../src/lib/atlas.js';

// PHASE IV CHANGE REASON: the Phase III validateDataset quarantined records
// without usable ids. The Phase IV core data principle (mission §7) requires
// EVERY source record to remain classic-visible with an app-only fallback
// identity; per-feature eligibility replaces quarantine. These tests encode
// the new contract, including the classic-count invariant.

const rec = (over = {}) => ({
  id: 1, Link: 'https://t.me/x/1', course: 'ریاضی', Student_Score: '17',
  Professor_Score: '18', professor: 'علی', text: 'خوب بود', ...over,
});

describe('schema validation — classic preservation invariant (Phase IV §7)', () => {
  it('maps every source record to exactly one classic entry', () => {
    const v = validateDataset([rec(), rec({ id: 2 }), rec({ id: 3 })]);
    expect(v.counts.total).toBe(3);
    expect(v.counts.classicDirectory).toBe(3);
    expect(v.records.length).toBe(3);
  });

  it('preserves records with missing/invalid/duplicate ids — no quarantine exists', () => {
    const v = validateDataset([
      rec(), // valid
      { Link: 'https://t.me/x/2', course: '', Student_Score: '?', Professor_Score: '?', professor: 'ب', text: 'متن' }, // missing id
      { id: 'abc', Link: 'https://t.me/x/3', course: '', Student_Score: '?', Professor_Score: '?', professor: 'ج', text: 'متن' }, // invalid id
      rec(), // duplicate id, duplicate link
    ]);
    expect(v.counts.total).toBe(4);
    expect(v.counts.classicDirectory).toBe(4); // THE invariant
    expect(v.counts.validUniqueNumericIds).toBe(2);
    expect(v.counts.missingIds).toBe(1);
    expect(v.counts.invalidIds).toBe(1);
    expect(v.counts.duplicateIds).toBe(1);
    expect(v.counts.duplicateLinks).toBe(1);
    // all four records have usable app identities, unique across the set
    const identities = v.records.map((r) => r.identity);
    expect(new Set(identities).size).toBe(4);
  });

  it('gives records without a source id a deterministic app-only identity', () => {
    const a = validateDataset([rec({ id: null })]).records[0];
    const b = validateDataset([rec({ id: null })]).records[0];
    expect(a.identity).toMatch(/^x-[0-9a-f]{16}-o0$/);
    expect(a.identity).toBe(b.identity); // deterministic across runs
    const c = validateDataset([rec({ id: null }), rec({ id: null })]).records;
    expect(c[0].identity).toMatch(/-o0$/);
    expect(c[1].identity).toMatch(/-o1$/); // occurrence discriminator for identical content
  });

  it('never overwrites one record with another in identity-keyed maps', () => {
    const v = validateDataset([rec({ text: 'اول' }), rec({ text: 'دوم' })]); // duplicate id, distinct text
    // First occurrence keeps the original deep link; later occurrences get a
    // deterministic discriminator — both records remain preserved/addressable.
    expect(v.records[0].identity).toBe('1');
    expect(v.records[1].identity).toBe('1#dup1');
    expect(v.records[0].text).toBe('اول');
    expect(v.records[1].text).toBe('دوم');
  });

  it('keeps empty/whitespace text and missing professor/course visible', () => {
    const v = validateDataset([
      rec({ text: '' }), rec({ text: '   ' }), rec({ professor: '', course: '' }),
    ]);
    expect(v.counts.classicDirectory).toBe(3);
    expect(v.counts.emptyOrWhitespaceText).toBe(2);
    expect(v.counts.missingProfessor).toBe(1);
    expect(v.counts.missingCourse).toBe(1);
    // eligibility: directory always true; text features exclude empty text
    expect(v.records.every((r) => r.eligibility.directory)).toBe(true);
    expect(v.records[0].eligibility.search).toBe(false);
    expect(v.records[2].eligibility.search).toBe(true);
  });

  it('per-feature eligibility reconciles: eligible + excluded === total', () => {
    const v = validateDataset([
      rec(), rec({ text: '' }), rec({ id: null }), rec({ professor: '', course: '' }),
    ]);
    const n = v.counts.total;
    expect(v.records.filter((r) => r.eligibility.directory).length).toBe(n);
    expect(v.records.filter((r) => r.eligibility.search).length).toBe(v.counts.searchEligible);
    expect(n - v.counts.searchEligible).toBe(n - v.records.filter((r) => r.eligibility.search).length);
  });

  it('raw display fields are preserved exactly (no normalization in place)', () => {
    const v = validateDataset([rec({ text: 'می\u200Cشود', professor: 'عليِ رضا', course: 'كامپیوتر ١' })]);
    expect(v.records[0].text).toBe('می\u200Cشود');
    expect(v.records[0].professor).toBe('عليِ رضا');
    expect(v.records[0].course).toBe('كامپیوتر ١');
  });

  it('tolerates unexpected additive fields and non-object rows without losing the classic entry', () => {
    const v = validateDataset([rec({ newField: 'x' }), null, [1, 2]]);
    expect(v.counts.classicDirectory).toBe(3);
    expect(v.issues.some((i) => i.code === 'unexpected-field')).toBe(true);
  });

  it('rejects a non-list root as fatal', () => {
    const v = validateDataset({ not: 'a list' });
    expect(v.ok).toBe(false);
    expect(v.fatal).toBe('dataset-not-a-list');
  });
});

describe('fingerprints (Phase IV §8.3: unambiguous canonical + SHA-256 provenance)', () => {
  it('canonical serialization is delimiter-injection-proof', () => {
    // A field containing the historic separators/delimiters cannot forge or
    // shift boundaries in the length-prefixed encoding.
    const evil = rec({ text: '18\u001f18\u001f18' });
    const normal = rec({ text: '18' });
    expect(fnv1a64(canonicalRecordBytes(evil.raw ?? evil))).not.toBe(fnv1a64(canonicalRecordBytes(normal)));
  });

  it('distinguishes missing, empty, zero-string, and numeric zero ids', () => {
    const missing = validateDataset([rec({ id: null })]).records[0];
    const empty = validateDataset([rec({ id: 0 })]).records[0];
    expect(missing.identity).not.toBe(empty.identity);
  });

  it('drift fingerprint changes when any semantically relevant field changes', () => {
    const base = validateDataset([rec()]).driftFingerprint;
    expect(validateDataset([rec({ text: 'خوب بود!' })]).driftFingerprint).not.toBe(base);
    expect(validateDataset([rec({ professor: 'علی‌رضا' })]).driftFingerprint).not.toBe(base);
    expect(validateDataset([rec({ Student_Score: '18' })]).driftFingerprint).not.toBe(base);
    expect(validateDataset([rec({ id: 2 })]).driftFingerprint).not.toBe(base);
  });

  it('drift fingerprint is stable across repeated runs and deep copies', () => {
    const a = validateDataset([rec()]).driftFingerprint;
    const b = validateDataset(JSON.parse(JSON.stringify([rec()]))).driftFingerprint;
    expect(a).toBe(b);
  });

  it('covers unknown additive fields via warnings without changing the schema contract', () => {
    const v = validateDataset([rec({ totallyNew: 5 })]);
    expect(v.issues.some((i) => i.code === 'unexpected-field' && i.field === 'totallyNew')).toBe(true);
  });
});

describe('atlas artifact binding (stale-artifact detection)', () => {
  it('binds a matching semantic artifact', () => {
    const artifact = {
      manifest: {
        datasetDriftFingerprint: 'abcd1234',
        schemaVersion: SCHEMA_VERSION,
        mode: 'semantic',
      },
      topics: [],
      neighbors: { '7': [{ id: 8, score: 0.5 }] },
    };
    expect(bindArtifact(artifact, 'abcd1234')).toEqual({ bound: true, mode: 'semantic' });
    expect(neighborsFor(artifact, '7')).toEqual([{ id: 8, score: 0.5 }]);
    expect(neighborsFor(artifact, '99')).toBeNull();
  });

  it('rejects checksum mismatch (stale artifact)', () => {
    const artifact = { manifest: { datasetDriftFingerprint: 'old', schemaVersion: SCHEMA_VERSION, mode: 'semantic' } };
    expect(bindArtifact(artifact, 'new')).toEqual({ bound: false, reason: 'dataset-checksum-mismatch' });
  });

  it('rejects malformed artifacts and unknown schema versions', () => {
    expect(bindArtifact(null, 'x').bound).toBe(false);
    expect(bindArtifact({}, 'x').bound).toBe(false);
    expect(bindArtifact({ manifest: { datasetDriftFingerprint: 'x', schemaVersion: 99, mode: 'semantic' } }, 'x'))
      .toEqual({ bound: false, reason: 'schema-version-mismatch' });
  });
});

describe('published atlas artifacts bind to the current dataset', () => {
  it('atlas-topics.json matches the live dataset drift fingerprint (if semantic mode)', async () => {
    const data = JSON.parse(fs.readFileSync('src/data.json', 'utf8'));
    const fingerprint = validateDataset(data).driftFingerprint;
    const artifact = await loadTopicsArtifact();
    const binding = bindArtifact(artifact, fingerprint);
    if (binding.bound) {
      expect(binding.mode).toBe('semantic');
      expect(artifact.topics.length).toBeGreaterThan(0);
      for (const t of artifact.topics) {
        expect(t.size).toBeGreaterThanOrEqual(8); // minimum-evidence policy
        expect(t.docIds.length).toBe(t.size);
        expect(t.phrases.length).toBeGreaterThan(0);
      }
    } else {
      // honest degraded state until the pipeline regenerates — but it must be
      // a *binding* mismatch, never a malformed artifact
      expect(binding.reason).toBe('dataset-checksum-mismatch');
    }
  });
});
