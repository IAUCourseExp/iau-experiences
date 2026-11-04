import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, validateDataset } from '../../src/lib/schema.js';
import { bindArtifact, neighborsFor } from '../../src/lib/atlas.js';

// Remediation contract (2026-11 regression): the deployed neighbors artifact
// shipped as an EMPTY stub (`"neighbors": {}`), which made the per-card
// similar-experiences feature dead on every card while the frontend honestly
// reported it unavailable. These tests lock the structural, integrity and
// honesty contract of the shipped semantic artifacts so a stub can never be
// released silently again.

const readJson = (rel) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

const rawRecords = readJson('../../src/data.json');
const validation = validateDataset(rawRecords);
const drift = validation.driftFingerprint;
const identities = new Set(validation.records.map((r) => r.identity));

const neighborsArtifact = readJson('../../src/derived/atlas-neighbors.json');
const topicsArtifact = readJson('../../src/derived/atlas-topics.json');

const neighborMap = neighborsArtifact.neighbors;
const config = neighborsArtifact.manifest.config;
const audit = neighborsArtifact.diagnostics.neighborAudit;

describe('neighbors artifact — dataset binding & provenance', () => {
  it('binds to the exact dataset the browser receives (drift fingerprint)', () => {
    const binding = bindArtifact(neighborsArtifact, drift);
    expect(binding).toEqual({ bound: true, mode: 'semantic' });
    expect(neighborsArtifact.manifest.datasetDriftFingerprint).toBe(drift);
  });

  it('topics artifact binds to the same dataset with the same schema', () => {
    expect(topicsArtifact.manifest.datasetDriftFingerprint).toBe(drift);
    expect(neighborsArtifact.manifest.datasetFingerprint)
      .toBe(topicsArtifact.manifest.datasetFingerprint);
    expect(neighborsArtifact.manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(topicsArtifact.manifest.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('bindArtifact refuses stale or malformed artifacts (safety contract)', () => {
    expect(bindArtifact(null, drift)).toEqual({ bound: false, reason: 'malformed-artifact' });
    const stale = { ...neighborsArtifact, manifest: { ...neighborsArtifact.manifest, datasetDriftFingerprint: 'deadbeefdeadbeef' } };
    expect(bindArtifact(stale, drift)).toEqual({ bound: false, reason: 'dataset-checksum-mismatch' });
  });
});

describe('neighbors artifact — structural integrity of every list', () => {
  const topK = config.neighborTopK;
  const minScore = config.neighborMinScore;

  it('references only known record identities and never the record itself', () => {
    for (const [docId, list] of Object.entries(neighborMap)) {
      expect(identities.has(docId), `unknown neighbor key ${docId}`).toBe(true);
      const ids = list.map((n) => n.id);
      expect(ids).not.toContain(docId);
      expect(new Set(ids).size, `duplicate neighbors for ${docId}`).toBe(ids.length);
      for (const id of ids) {
        expect(identities.has(id), `neighbor ${id} of ${docId} not in dataset`).toBe(true);
      }
    }
  });

  it('respects Top-K, the score threshold, the valid range, and descending order', () => {
    for (const [docId, list] of Object.entries(neighborMap)) {
      expect(list.length, docId).toBeLessThanOrEqual(topK);
      for (let i = 0; i < list.length; i++) {
        const s = list[i].score;
        expect(Number.isFinite(s), `${docId}[${i}] non-finite score`).toBe(true);
        expect(s).toBeGreaterThanOrEqual(minScore);
        expect(s).toBeLessThanOrEqual(1);
        if (i > 0) {
          expect(s, `${docId} not ranked descending at ${i}`).toBeLessThanOrEqual(list[i - 1].score);
        }
      }
    }
  });

  it('never contains a forced match: every published score clears the threshold', () => {
    // Honesty invariant (mission §3.3): a list entry exists only because its
    // similarity cleared neighborMinScore — never to fill the list.
    const below = Object.entries(neighborMap)
      .flatMap(([docId, list]) => list.filter((n) => n.score < minScore).map(() => docId));
    expect(below).toEqual([]);
  });
});

describe('neighbors artifact — audit diagnostics are truthful', () => {
  it('reports coverage that matches the actual neighbor map', () => {
    const actualDocs = Object.keys(neighborMap).length;
    expect(audit.documentsWithNeighbors).toBe(actualDocs);
    expect(audit.documentsEligible).toBeGreaterThan(0);
    expect(audit.coverage).toBeCloseTo(actualDocs / audit.documentsEligible, 4);
  });

  it('reports a neighbor-count histogram that matches the map', () => {
    const actual = {};
    for (const list of Object.values(neighborMap)) {
      actual[list.length] = (actual[list.length] || 0) + 1;
    }
    const reported = Object.fromEntries(Object.entries(audit.neighborCountHistogram).map(([k, v]) => [Number(k), v]));
    expect(reported).toEqual(actual);
  });

  it('reports the true hub record (most frequently referenced neighbor)', () => {
    const hubCounts = {};
    for (const list of Object.values(neighborMap)) {
      for (const n of list) hubCounts[n.id] = (hubCounts[n.id] || 0) + 1;
    }
    const maxCount = Math.max(...Object.values(hubCounts));
    expect(audit.hubMaxCount).toBe(maxCount);
    expect(audit.hubTop[0].count).toBe(maxCount);
    expect(hubCounts[audit.hubTop[0].id]).toBe(maxCount);
  });

  it('never claims semantic quality for an empty map (stub detector)', () => {
    // The 2026-11 regression shipped mode="lexical-fallback" with zero
    // content; a future regression must not ship mode="semantic" empty either.
    if (neighborsArtifact.manifest.mode === 'semantic') {
      expect(Object.keys(neighborMap).length).toBeGreaterThan(0);
    }
    expect(['semantic', 'lexical-fallback']).toContain(neighborsArtifact.manifest.mode);
  });
});

describe('neighbors loader — runtime contract (src/lib/atlas.js)', () => {
  it('returns the stored list for a record with neighbors, accepting number ids', () => {
    const withNeighbors = Object.keys(neighborMap)[0];
    const expected = neighborMap[withNeighbors];
    expect(neighborsFor(neighborsArtifact, Number(withNeighbors))).toEqual(expected);
    expect(neighborsFor(neighborsArtifact, withNeighbors)).toEqual(expected);
  });

  it('returns null — not an empty list — for the record with no similar match', () => {
    // Honest empty state: the dialog must distinguish "no similar experience
    // exists" from "artifact broken". Record 268 has no usable text and no
    // neighbor entry by design.
    expect(neighborsFor(neighborsArtifact, '268')).toBeNull();
  });
});

describe('topics artifact — content sanity (mode=semantic)', () => {
  it('every topic label is a non-empty corpus-derived string', () => {
    for (const topic of topicsArtifact.topics) {
      expect(typeof topic.label).toBe('string');
      expect(topic.label.trim().length).toBeGreaterThan(0);
      expect(topic.docIds.length).toBeGreaterThan(0);
    }
  });

  it('every topic member id exists in the dataset (no fabricated membership)', () => {
    for (const topic of topicsArtifact.topics) {
      for (const id of topic.docIds) {
        expect(identities.has(id), `topic ${topic.id} references unknown record ${id}`).toBe(true);
      }
    }
  });

  it('meets the published quality gate when in semantic mode', () => {
    if (topicsArtifact.manifest.mode === 'semantic') {
      expect(topicsArtifact.topics.length).toBeGreaterThanOrEqual(4);
      expect(topicsArtifact.diagnostics.thresholds.minStabilityAri).toBeGreaterThan(0);
    }
  });
});
