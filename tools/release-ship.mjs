#!/usr/bin/env node
/**
 * Phase IV release ship (mission §19.3) — the second half of the owner-run
 * `npm run deploy-all`. Stages, commits, pushes source changes, and deploys
 * the already-validated dist to the existing gh-pages branch.
 *
 * SAFETY:
 *  - refuses to run unless the preflight passed within the last 2 hours
 *    (marker file with a passing build fingerprint);
 *  - refuses detached HEAD / non-main branch / missing origin;
 *  - shows the exact files to be committed before staging;
 *  - never runs the production build after the push (build happens in
 *    preflight; gh-pages deploys the already-validated dist).
 *  - verifies current working tree still matches the preflight marker state.
 *
 * THE CODING AGENT NEVER EXECUTES THIS SCRIPT. It exists for the owner.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFLIGHT_MARKER = path.join(ROOT, 'audit-artifacts', 'preflight-passed.json');
const MAX_PREFLIGHT_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Cross-platform Node/npm/npx/gh-pages resolution
function resolveBin(name) {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.cmd' : '';
  // Prefer local node_modules/.bin
  const local = path.join(ROOT, 'node_modules', '.bin', name + ext);
  if (fs.existsSync(local)) return local;
  // Fall back to npx (will use lockfile-pinned version)
  return isWin ? 'npx.cmd' : 'npx';
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function computeFileHash(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function computeDirHash(dirpath) {
  if (!fs.existsSync(dirpath)) return null;
  const files = fs.readdirSync(dirpath).sort();
  const hashes = files
    .filter(f => fs.statSync(path.join(dirpath, f)).isFile())
    .map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(dirpath, f))).digest('hex'));
  return crypto.createHash('sha256').update(hashes.join('|')).digest('hex');
}

function fail(msg) {
  console.error('SHIP REFUSED: ' + msg);
  process.exit(1);
}

// 0. preflight gate
if (!fs.existsSync(PREFLIGHT_MARKER)) {
  fail(`no passing preflight found (${PREFLIGHT_MARKER}). Run: npm run release-preflight`);
}
const marker = JSON.parse(fs.readFileSync(PREFLIGHT_MARKER, 'utf8'));
if (Date.now() - marker.passedAt > MAX_PREFLIGHT_AGE_MS) {
  fail('the passing preflight is older than 2 hours. Re-run: npm run release-preflight');
}
console.log(`[ship] using preflight passed at ${marker.passedAt} (dataset ${marker.driftFingerprint?.slice(0, 8) ?? 'n/a'})`);

// 1. git state
if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') fail('not a git work tree');
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`branch is "${branch}", expected main`);
git(['remote', 'get-url', 'origin']); // throws if missing
console.log('[ship] git state OK (main, origin present)');

// 2. VERIFY current state still matches preflight marker
console.log('[ship] verifying preflight marker matches current working tree...');

// Check HEAD commit
const currentHead = git(['rev-parse', 'HEAD']);
if (marker.commit && currentHead !== marker.commit) {
  fail(`HEAD mismatch: preflight was at ${marker.commit.slice(0,8)}, now at ${currentHead.slice(0,8)}. Re-run preflight.`);
}
console.log(`  ✓ HEAD matches (${currentHead.slice(0,8)})`);

// Check branch
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (marker.branch && currentBranch !== marker.branch) {
  fail(`branch mismatch: preflight was on ${marker.branch}, now on ${currentBranch}.`);
}
console.log(`  ✓ branch matches (${currentBranch})`);

// Check remote URL
const currentRemote = git(['remote', 'get-url', 'origin']).replace(/^.*@/, '').replace(/\.git$/, '');
if (marker.remoteUrl && currentRemote !== marker.remoteUrl) {
  fail(`remote URL mismatch: ${currentRemote} !== ${marker.remoteUrl}`);
}
console.log(`  ✓ remote matches (${currentRemote})`);

// Check protected file hashes
const protectedFiles = {
  scraper: 'scraper.py',
  data: 'src/data.json',
  lastUpdate: 'src/last_update.json',
};
let hashMismatch = false;
for (const [key, relPath] of Object.entries(protectedFiles)) {
  const markerHash = marker.protectedHashes?.[key];
  const currentHash = computeFileHash(path.join(ROOT, relPath));
  if (markerHash && markerHash !== currentHash) {
    console.error(`  ✗ ${key} hash mismatch: marker=${markerHash.slice(0,16)} current=${currentHash.slice(0,16)}`);
    hashMismatch = true;
  } else {
    console.log(`  ✓ ${key} hash matches`);
  }
}
if (hashMismatch) fail('protected file hash mismatch — re-run preflight');

// Check package-lock.json hash
const pkgLockHash = computeFileHash(path.join(ROOT, 'package-lock.json'));
if (marker.packageLockHash && marker.packageLockHash !== pkgLockHash) {
  fail(`package-lock.json hash mismatch — re-run preflight`);
}
console.log(`  ✓ package-lock.json hash matches`);

// Check workflow hash
const workflowHash = computeFileHash(path.join(ROOT, '.github/workflows/Main.yml'));
if (marker.workflowHash && marker.workflowHash !== workflowHash) {
  fail('.github/workflows/Main.yml hash mismatch — re-run preflight');
}
console.log(`  ✓ workflow hash matches`);

// Check dist build fingerprint
const distHash = computeDirHash(path.join(ROOT, 'dist'));
if (marker.distHash && marker.distHash !== distHash) {
  fail('dist/ build output changed since preflight — re-run preflight');
}
console.log(`  ✓ dist build fingerprint matches`);

// Check dirty/clean state
const currentStatus = git(['status', '--porcelain']);
const currentDirty = currentStatus.trim().length > 0;
if (marker.dirty !== currentDirty) {
  fail(`working tree dirty state changed: preflight dirty=${marker.dirty}, now dirty=${currentDirty}`);
}
console.log(`  ✓ working tree dirty state matches (dirty=${currentDirty})`);

// Check changed files (tracked changes only)
const trackedChanges = currentStatus.trim() ? currentStatus.trim().split('\n').map(l => l.trim().slice(3)).sort() : [];
if (marker.changedFiles) {
  const markerFiles = [...marker.changedFiles].sort();
  if (JSON.stringify(markerFiles) !== JSON.stringify(trackedChanges)) {
    fail('tracked file changes differ from preflight — re-run preflight');
  }
}
console.log(`  ✓ tracked file changes match preflight`);

console.log('[ship] preflight marker verification PASSED — working tree unchanged');

// 3. show what would be committed
if (!currentStatus) {
  console.log('[ship] nothing to commit — working tree clean.');
  console.log('[ship] continuing to deploy the previously built dist (as preflight verified).');
} else {
  console.log('[ship] files to be committed:');
  console.log(currentStatus.split('\n').map((l) => '   ' + l).join('\n'));
}

// 4. stage + commit (idempotent when nothing changed)
if (currentStatus) {
  git(['add', '-A']);
  git(['commit', '-m', `Release: validated build ${marker.driftFingerprint?.slice(0, 8) ?? ''} (${new Date().toISOString().slice(0, 10)})`]);
  console.log('[ship] committed.');
}

// 5. push
console.log('[ship] pushing main...');
git(['push', 'origin', 'main']);
console.log('[ship] pushed.');

// 6. deploy the validated dist to gh-pages
console.log('[ship] deploying dist to gh-pages...');

// Use locally installed gh-pages (pinned in package.json) via npx or direct bin
const ghPagesBin = resolveBin('gh-pages');
const ghPagesArgs = ['-d', 'dist', '-m', `Pages deploy ${marker.driftFingerprint?.slice(0, 8) ?? ''}`];

if (ghPagesBin.endsWith('npx.cmd') || ghPagesBin.endsWith('npx')) {
  // npx will use the lockfile-pinned version
  execFileSync(ghPagesBin, ['gh-pages', ...ghPagesArgs], { cwd: ROOT, stdio: 'inherit' });
} else {
  // Direct binary
  execFileSync(ghPagesBin, ghPagesArgs, { cwd: ROOT, stdio: 'inherit' });
}

console.log('[ship] deployed. GitHub Pages will serve the new build shortly.');
console.log('[ship] DONE — released by the owner.');