#!/usr/bin/env node
/**
 * Phase IV artifact validation gate (mission §13.6 step 10).
 * Runs after the NLP pipeline in CI and locally: verifies the generated
 * artifacts bind to the current src/data.json, carry the current schema
 * version, and contain no dangling references. Fails the workflow on any
 * mismatch so a stale/invalid artifact set can never be deployed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(name, fn) {
  process.stdout.write(`[validate] ${name} ... `);
  try {
    const detail = fn();
    console.log('OK', detail ? `(${detail})` : '');
  } catch (err) {
    console.log('FAILED');
    console.error('  ✗ ' + (err && err.message || err));
    failures += 1;
  }
}

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data.json'), 'utf8'));
const { validateDataset } = await import('file://' + path.join(ROOT, 'src/lib/schema.js').replace(/\\/g, '/'));
const validation = validateDataset(data);
const drift = validation.driftFingerprint;
const allIds = new Set(validation.records.map((r) => r.identity));

check('classic preservation: every source record has a classic view-model', () => {
  if (validation.ok !== true) throw new Error(validation.fatal);
  if (validation.counts.classicDirectory !== data.length) {
    throw new Error(`classicDirectory=${validation.counts.classicDirectory} but source=${data.length}`);
  }
  return `${validation.counts.classicDirectory}/${validation.counts.total}`;
});

check('unique identities (no silent Map overwrites)', () => {
  const identities = validation.records.map((r) => r.identity);
  if (new Set(identities).size !== identities.length) throw new Error('duplicate identities');
  return `${identities.length} unique`;
});

check('per-feature eligibility reconciles', () => {
  const c = validation.counts;
  if (c.searchEligible > c.total) throw new Error('searchEligible > total');
  if (c.searchEligible !== c.withText) throw new Error('searchEligible != withText');
  return `search ${c.searchEligible}/${c.total}, topics ${c.topicEligible}/${c.total}`;
});

check('atlas-topics.json exists and binds to the dataset', () => {
  const p = path.join(ROOT, 'src/derived/atlas-topics.json');
  const artifact = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = artifact.manifest;
  if (m.schemaVersion !== 2) throw new Error(`schemaVersion ${m.schemaVersion} != 2`);
  if (m.datasetDriftFingerprint !== drift) throw new Error('drift fingerprint mismatch (stale artifact)');
  if (m.mode !== 'semantic' && m.mode !== 'lexical-fallback') throw new Error(`unknown mode ${m.mode}`);
  if (m.mode === 'semantic') {
    if (!Array.isArray(artifact.topics) || artifact.topics.length === 0) throw new Error('semantic mode without topics');
    let memberTotal = 0;
    for (const t of artifact.topics) {
      if (t.size !== t.docIds.length) throw new Error(`topic ${t.id} size/docIds mismatch`);
      for (const id of t.docIds) if (!allIds.has(id)) throw new Error(`dangling member ${id} in ${t.id}`);
      memberTotal += t.size;
    }
    return `${artifact.topics.length} topics, ${memberTotal} members, mode=semantic`;
  }
  return 'lexical-fallback mode (honest abstention)';
});

check('atlas-neighbors.json exists and binds to the dataset', () => {
  const p = path.join(ROOT, 'src/derived/atlas-neighbors.json');
  const artifact = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = artifact.manifest;
  if (m.datasetDriftFingerprint !== drift) throw new Error('drift fingerprint mismatch (stale artifact)');
  if (m.mode !== 'semantic') return 'lexical-fallback: no neighbor artifact expected';
  const entries = Object.entries(artifact.neighbors);
  for (const [key, list] of entries) {
    if (!allIds.has(key)) throw new Error(`neighbor key ${key} not in dataset`);
    if (list.some((n) => !allIds.has(n.id))) throw new Error(`dangling neighbor of ${key}`);
    if (list.some((n) => n.id === key)) throw new Error(`self-neighbor ${key}`);
  }
  return `${entries.length} docs with neighbors, all references valid`;
});

check('no model weights or ML runtime files in src/derived', () => {
  const derived = path.join(ROOT, 'src/derived');
  for (const f of fs.readdirSync(derived)) {
    if (/\.(safetensors|onnx|bin|pt|pth|ckpt)$/i.test(f)) throw new Error(`model-weight-like file: ${f}`);
  }
  return 'clean';
});

console.log('');
if (failures > 0) {
  console.error(`ARTIFACT VALIDATION FAILED (${failures} gate${failures > 1 ? 's' : ''}).`);
  process.exit(1);
}
console.log('ARTIFACT VALIDATION PASSED.');
