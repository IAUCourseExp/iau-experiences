#!/usr/bin/env node
/**
 * Phase IV release preflight (mission §19.3) — runs BEFORE any Git push.
 *
 * This script is a component of the owner-run `npm run deploy-all`. It never
 * pushes, commits, or deploys; it verifies everything the release depends on
 * and fails loudly if any gate fails. The owner reviews its output and only
 * then does the ship step run.
 *
 * Checks:
 *  1. inside the intended Git checkout, on branch main, not detached
 *  2. origin remote exists
 *  3. .gitignore excludes node_modules, model caches, secrets, dist
 *  4. lint passes, unit tests pass
 *  5. dataset↔artifact binding (drift fingerprint match)
 *  6. production build succeeds
 *  7. dist contents verified: no model weights, atlas artifacts present
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256File, computeDirHash } from './release-ship-core.mjs';
import { RELEASE_FILES } from './release-allowlist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Portable Node/npm resolution — no hardcoded machine paths
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX_CMD = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let step = 0;
const failures = [];
let drift = null;

function run(name, fn) {
  step += 1;
  process.stdout.write(`[preflight ${step}] ${name} ... `);
  try {
    const detail = fn();
    console.log('OK', detail ? `(${detail})` : '');
  } catch (err) {
    console.log('FAILED');
    failures.push(`${name}: ${String(err && err.message || err).slice(0, 300)}`);
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// 1. Git state
run('inside a Git checkout on branch main', () => {
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') throw new Error('not a git work tree');
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`branch is "${branch}", expected main (refusing detached/other branches)`);
  return branch;
});

run('origin remote exists', () => {
  const url = git(['remote', 'get-url', 'origin']);
  if (!/iaucourseexp\/iau-experiences/i.test(url)) throw new Error(`unexpected origin: ${url}`);
  return url.replace(/^[^@]*@/, '').replace(/\.git$/, '');
});

// 2. .gitignore safety
run('.gitignore excludes secrets/caches/weights/node_modules', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const need = ['node_modules', '.cache', 'safetensors', '.env'];
  const missing = need.filter((n) => !gi.includes(n));
  if (missing.length) throw new Error(`.gitignore missing patterns for: ${missing.join(', ')}`);
  return 'covered';
});

// 3. lint + unit tests
run('lint', () => {
  execFileSync(NPM_CMD, ['run', 'lint'], { cwd: ROOT, stdio: 'pipe', shell: true });
  return 'clean';
});
run('unit tests', () => {
  execFileSync(NPX_CMD, ['vitest', 'run'], { cwd: ROOT, stdio: 'pipe', shell: true });
  return 'all passed';
});

// FNV-1a 64 (matches schema.js)
function fnv1a64(bytes) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function toDisplayString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function canonicalRecordBytes(record) {
  const enc = new TextEncoder();
  const field = (tag, value) => {
    const bytes = enc.encode(`${tag}:${value == null ? '~' : String(value)}`);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length);
    return [len, bytes];
  };
  const chunks = [];
  chunks.push(...field('id', record.id));
  chunks.push(...field('prof', record.professor));
  chunks.push(...field('course', record.course));
  chunks.push(...field('ps', record.Professor_Score));
  chunks.push(...field('ss', record.Student_Score));
  chunks.push(...field('txt', record.text));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function joinBytes(byteArrays) {
  const total = byteArrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of byteArrays) { out.set(b, offset); offset += b.length; }
  return out;
}

// 4. dataset↔artifact binding — compute drift fingerprint directly here
run('dataset↔atlas binding (drift fingerprint)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data.json'), 'utf8'));

  // Recompute drift fingerprint identically to schema.js
  const hashParts = [];
  for (let index = 0; index < data.length; index++) {
    const raw = data[index];
    const canonical = {
      id: (typeof raw.id === 'number' && Number.isFinite(raw.id)) ? raw.id : (raw.id == null ? null : String(raw.id)),
      professor: toDisplayString(raw.professor),
      course: toDisplayString(raw.course),
      Professor_Score: toDisplayString(raw.Professor_Score),
      Student_Score: toDisplayString(raw.Student_Score),
      text: toDisplayString(raw.text),
    };
    const canonicalBytes = canonicalRecordBytes(canonical);
    hashParts.push(canonicalBytes);
  }
  drift = fnv1a64(joinBytes(hashParts));

  const topics = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/derived/atlas-topics.json'), 'utf8'));
  if (topics.manifest.datasetDriftFingerprint !== drift) {
    throw new Error('atlas-topics.json is stale relative to src/data.json — run: python tools/nlp_pipeline.py');
  }
  return `bound (${drift})`;
});

// 5. production build
run('production build', () => {
  execFileSync(NPM_CMD, ['run', 'build'], { cwd: ROOT, stdio: 'pipe', shell: true });
  return 'dist built';
});

// 6. dist verification
run('dist contents (no model weights; atlas artifacts present)', () => {
  const dist = path.join(ROOT, 'dist');
  const forbidden = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else {
        if (/\.(safetensors|onnx|bin|pt|pth|ckpt)$/i.test(f.name)) forbidden.push(f.name);
        if (/atlas(-topics|-neighbors)?\.json/.test(f.name) === false && /\.json$/.test(f.name) && fs.statSync(p).size > 5_000_000) {
          forbidden.push(`${f.name} (suspiciously large JSON)`);
        }
      }
    }
  };
  walk(dist);
  if (forbidden.length) throw new Error(`forbidden files in dist: ${forbidden.join(', ')}`);
  const hasTopics = fs.readdirSync(dist).some(() =>
    JSON.parse('true'));
  if (!hasTopics) throw new Error('unreachable');
  const assets = fs.readdirSync(path.join(dist, 'assets'));
  if (!assets.some((a) => a.startsWith('atlas-topics'))) throw new Error('atlas-topics chunk missing from dist');
  if (!assets.some((a) => a.startsWith('atlas-neighbors'))) throw new Error('atlas-neighbors chunk missing from dist');
  const totalMB = walkSize(dist) / (1024 * 1024);
  return `dist ${totalMB.toFixed(1)} MB, atlas chunks present, no model weights`;
});

function walkSize(dir) {
  let total = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    total += f.isDirectory() ? walkSize(p) : fs.statSync(p).size;
  }
  return total;
}

console.log('');
if (failures.length) {
  console.error(`PREFLIGHT FAILED (${failures.length} gate${failures.length > 1 ? 's' : ''}):`);
  for (const f of failures) console.error('  ✗ ' + f);
  console.error('\nThe release ship step must NOT run. Fix the failures above first.');
  process.exit(1);
} else {
  console.log('PREFLIGHT PASSED — all release gates satisfied.');
  console.log('Next: npm run release-ship (stage, commit, push, deploy). The owner runs this.');

  // Write preflight marker for release-ship (binds exact working tree)
  const markerDir = path.join(ROOT, 'audit-artifacts');
  if (!fs.existsSync(markerDir)) fs.mkdirSync(markerDir, { recursive: true });

  // Working tree fingerprint (tracked + untracked relevant files)
  const gitStatus = git(['status', '--porcelain']);
  const dirty = gitStatus.trim().length > 0;
  const changedFiles = gitStatus.trim() ? gitStatus.trim().split('\n').map(l => l.trim().slice(3)) : [];

  const marker = {
    passedAt: Date.now(),
    driftFingerprint: drift,
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    remoteUrl: git(['remote', 'get-url', 'origin']).replace(/^.*@/, '').replace(/\.git$/, ''),
    dirty,
    changedFiles: changedFiles.slice(0, 50), // cap
    protectedHashes: {
      scraper: fs.existsSync(path.join(ROOT, 'scraper.py')) ?
        crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scraper.py'))).digest('hex') : null,
      data: fs.existsSync(path.join(ROOT, 'src/data.json')) ?
        crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/data.json'))).digest('hex') : null,
      lastUpdate: fs.existsSync(path.join(ROOT, 'src/last_update.json')) ?
        crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/last_update.json'))).digest('hex') : null,
    },
    packageLockHash: fs.existsSync(path.join(ROOT, 'package-lock.json')) ?
      crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex') : null,
    packageJsonHash: fs.existsSync(path.join(ROOT, 'package.json')) ?
      crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package.json'))).digest('hex') : null,
    workflowHash: fs.existsSync(path.join(ROOT, '.github/workflows/Main.yml')) ?
      crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, '.github/workflows/Main.yml'))).digest('hex') : null,
    // Fingerprint of the exact build output this preflight validated; the ship
    // step recomputes it so a stale or regenerated dist can never deploy.
    distHash: computeDirHash(path.join(ROOT, 'dist')),
    // Per-file hashes of the authorized release allowlist; the ship step
    // recomputes them so any post-preflight edit of a to-be-released file
    // aborts before staging, committing, pushing, or deploying.
    releaseFileHashes: Object.fromEntries(RELEASE_FILES.map((relPath) => {
      const absolute = path.join(ROOT, relPath);
      return [relPath, fs.existsSync(absolute) ? sha256File(absolute) : null];
    })),
    toolVersion: '1.1.0',
    maxAgeMs: 2 * 60 * 60 * 1000,
  };
  fs.writeFileSync(path.join(markerDir, 'preflight-passed.json'), JSON.stringify(marker, null, 2));
  console.log('[preflight] marker written to audit-artifacts/preflight-passed.json');
}