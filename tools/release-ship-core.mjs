/**
 * Hardened local release pipeline core (used by tools/release-ship.mjs).
 *
 * All checks are fail-closed and run BEFORE any Git mutation or deployment:
 *   1. The preflight marker is present, fresh, internally complete, and the
 *      exact Git state it validated (branch, HEAD, remote) still holds.
 *   2. Every file about to ship hashes identically to what preflight verified
 *      (protected files, package manifests, workflow, dist/, release files),
 *      so any post-preflight change aborts the release.
 *   3. The working tree contains no changes outside the release allowlist and
 *      the known preserved set; the index contains no pre-staged paths other
 *      than the explicitly authorized ones. Preserved content is never
 *      staged, never discarded.
 *   4. The locally installed gh-pages CLI must exist; deployment runs through
 *      `process.execPath` (no shell, no npx, no dynamic download) and
 *      publishes exactly `dist/`.
 *   5. Deployment runs BEFORE the release commit: a failed deployment leaves
 *      `main` (local index, local branch, remote branch) completely
 *      untouched. The commit is created with a pathspec so pre-existing
 *      staged content outside the allowlist can never enter it, and the
 *      resulting commit is re-inspected before the push.
 *
 * The module takes its Git runner, deployer, filesystem root, environment,
 * clock, and logger via `io`, so the full pipeline can be exercised in unit
 * tests with injected fakes — no network, no Git writes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  RELEASE_FILES,
  AUTHORIZED_PRESTAGED_PATHS,
  PRESERVED_PATHS,
} from './release-allowlist.mjs';

export class ShipError extends Error {}

const MARKER_RELATIVE_PATH = path.join('audit-artifacts', 'preflight-passed.json');
const REQUIRED_MARKER_FIELDS = [
  'passedAt',
  'driftFingerprint',
  'commit',
  'branch',
  'remoteUrl',
  'dirty',
  'changedFiles',
  'protectedHashes',
  'packageLockHash',
  'packageJsonHash',
  'workflowHash',
  'distHash',
  'releaseFileHashes',
];

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** Deterministic fingerprint of a directory tree (sorted relative paths). */
export function computeDirHash(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const entries = [...fs.readdirSync(dirPath, { withFileTypes: true })]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const parts = [];
  for (const entry of entries) {
    const child = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = computeDirHash(child);
      if (nested !== null) parts.push(`${entry.name}/:${nested}`);
    } else {
      parts.push(`${entry.name}:${sha256File(child)}`);
    }
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Resolve the locally installed, lockfile-pinned gh-pages CLI entry point. */
export function resolveGhPagesCli(root) {
  const cliPath = path.join(root, 'node_modules', 'gh-pages', 'bin', 'gh-pages.js');
  if (!fs.existsSync(cliPath)) {
    throw new ShipError(
      `the pinned gh-pages CLI was not found at ${cliPath}. ` +
      'Run: npm ci (or npm install). The pipeline never downloads packages at release time.'
    );
  }
  const manifestPath = path.join(root, 'node_modules', 'gh-pages', 'package.json');
  let version = 'unknown';
  try {
    version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version || version;
  } catch {
    // Version display is informational only.
  }
  return { cliPath, version };
}

/** Extract the changed path from one `git status --porcelain` line. */
export function parseStatusPath(line) {
  const body = line.slice(3);
  const renameArrow = body.indexOf(' -> ');
  return renameArrow !== -1 ? body.slice(renameArrow + 4) : body;
}

function sanitizeRemote(url) {
  return String(url).replace(/^.*@/, '').replace(/\.git$/, '');
}

function fail(message) {
  throw new ShipError(message);
}

/**
 * Run the full release pipeline.
 *
 * @param {object} io Injected dependencies:
 *   root       - absolute workspace root
 *   git        - (args: string[]) => string  (trimmed stdout; throws on failure)
 *   execFile   - (cmd, args, opts) => void   (deploy subprocess runner)
 *   env        - process-style env object
 *   nowMs      - () => number
 *   log        - (...parts) => void
 */
export function runShip(io) {
  const { root, git, execFile, env, nowMs, log } = io;
  const verifyOnly = env.IAU_RELEASE_VERIFY_ONLY === '1';
  const allowlist = [...RELEASE_FILES];
  const allowlistSet = new Set(allowlist);
  const preservedSet = new Set(PRESERVED_PATHS);
  const authorizedPrestagedSet = new Set(AUTHORIZED_PRESTAGED_PATHS);

  // ---- 0. preflight marker gate -------------------------------------------
  const markerPath = path.join(root, MARKER_RELATIVE_PATH);
  if (!fs.existsSync(markerPath)) {
    fail(`no passing preflight found (${markerPath}). Run: npm run release-preflight`);
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (err) {
    fail(`preflight marker is not valid JSON (${err.message}). Re-run: npm run release-preflight`);
  }
  const missingFields = REQUIRED_MARKER_FIELDS.filter((field) => marker[field] === undefined);
  if (missingFields.length) {
    fail(`preflight marker is missing required field(s): ${missingFields.join(', ')}. ` +
      'The marker was written by an older tool version — re-run: npm run release-preflight');
  }
  const maxAgeMs = Number.isFinite(marker.maxAgeMs) && marker.maxAgeMs > 0 ? marker.maxAgeMs : 2 * 60 * 60 * 1000;
  if (nowMs() - marker.passedAt > maxAgeMs) {
    fail('the passing preflight is older than the allowed window. Re-run: npm run release-preflight');
  }
  log(`[ship] using preflight passed at ${new Date(marker.passedAt).toISOString()} (dataset ${String(marker.driftFingerprint).slice(0, 16)})`);

  // ---- 1. Git identity must match the marker ------------------------------
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') fail('not a git work tree');
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') fail(`branch is "${branch}", expected main`);
  if (marker.branch !== branch) fail(`branch mismatch: preflight ran on "${marker.branch}", now on "${branch}"`);
  const head = git(['rev-parse', 'HEAD']);
  if (marker.commit && head !== marker.commit) {
    fail(`HEAD changed since preflight: marker=${marker.commit}, now=${head}. Re-run: npm run release-preflight`);
  }
  const remote = sanitizeRemote(git(['remote', 'get-url', 'origin']));
  if (marker.remoteUrl && remote !== marker.remoteUrl) {
    fail(`origin changed since preflight: marker=${marker.remoteUrl}, now=${remote}`);
  }
  log('[ship] git state matches preflight (main, HEAD, origin)');

  // ---- 2. Content hashes must match the marker ----------------------------
  const protectedTargets = {
    scraper: 'scraper.py',
    data: 'src/data.json',
    lastUpdate: 'src/last_update.json',
  };
  for (const [key, relPath] of Object.entries(protectedTargets)) {
    const expected = marker.protectedHashes?.[key];
    const actual = fs.existsSync(path.join(root, relPath)) ? sha256File(path.join(root, relPath)) : null;
    if (expected !== actual) {
      fail(`protected file changed since preflight: ${relPath}. Re-run: npm run release-preflight`);
    }
  }
  const hashTargets = {
    'package.json': marker.packageJsonHash,
    'package-lock.json': marker.packageLockHash,
    '.github/workflows/Main.yml': marker.workflowHash,
  };
  for (const [relPath, expected] of Object.entries(hashTargets)) {
    const actual = fs.existsSync(path.join(root, relPath)) ? sha256File(path.join(root, relPath)) : null;
    if (expected !== actual) {
      fail(`${relPath} changed since preflight. Re-run: npm run release-preflight`);
    }
  }
  const distHash = computeDirHash(path.join(root, 'dist'));
  if (marker.distHash !== distHash) {
    fail('dist/ changed since preflight — the build output is not the validated build. Re-run: npm run release-preflight');
  }
  for (const relPath of allowlist) {
    const expected = marker.releaseFileHashes?.[relPath];
    const filePath = path.join(root, relPath);
    if (expected === undefined) {
      fail(`preflight marker has no recorded hash for release file ${relPath}. Re-run: npm run release-preflight`);
    }
    const actual = fs.existsSync(filePath) ? sha256File(filePath) : null;
    if (expected !== actual) {
      fail(`release file changed since preflight: ${relPath}. Re-run: npm run release-preflight`);
    }
  }
  try {
    const topicsManifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'derived', 'atlas-topics.json'), 'utf8'));
    if (topicsManifest.manifest?.datasetDriftFingerprint !== marker.driftFingerprint) {
      fail('atlas-topics.json drift fingerprint does not match the preflight marker (stale artifacts).');
    }
  } catch (err) {
    if (err instanceof ShipError) throw err;
    fail(`cannot read src/derived/atlas-topics.json: ${err.message}`);
  }
  log('[ship] all content hashes match the preflight marker (protected, manifests, workflow, dist, release files)');

  // ---- 3. Working-tree scope check ----------------------------------------
  const statusLines = git(['status', '--porcelain']).split('\n').filter(Boolean);
  const statusPaths = statusLines.map(parseStatusPath);
  const unexpected = statusPaths.filter(
    (p) => !allowlistSet.has(p) && !preservedSet.has(p) && !authorizedPrestagedSet.has(p)
  );
  if (unexpected.length) {
    fail(`unexpected working-tree change(s) outside the release allowlist and preserved set: ${unexpected.join(', ')}. ` +
      'Resolve them manually before releasing.');
  }
  const preservedPresent = statusPaths.filter((p) => preservedSet.has(p) || authorizedPrestagedSet.has(p));
  if (preservedPresent.length) {
    log('[ship] preserved (NOT staged, requires explicit authorization): ' + preservedPresent.join(', '));
  }
  const allowlistChanges = statusPaths.filter((p) => allowlistSet.has(p));
  const prestagedAuthorizedBefore = git(['diff', '--cached', '--name-only'])
    .split('\n').filter(Boolean)
    .filter((p) => authorizedPrestagedSet.has(p));
  const prestagedUnexpected = git(['diff', '--cached', '--name-only'])
    .split('\n').filter(Boolean)
    .filter((p) => !authorizedPrestagedSet.has(p) && !allowlistSet.has(p));
  if (prestagedUnexpected.length) {
    fail(`unexpected pre-staged content in the index: ${prestagedUnexpected.join(', ')}. ` +
      'Resolve it manually; the pipeline will not discard it.');
  }
  // Post-preflight state drift that does not change file sets (e.g. a file
  // flipped between modified/unmodified) is already caught by the hash checks.
  // Both sides are restricted to the release allowlist: the marker records
  // every working-tree change (including preserved untracked files), while
  // preserved content is governed by the scope check above, not this check.
  const currentChanged = [...statusPaths].filter((p) => allowlistSet.has(p)).sort();
  const markerChanged = [...marker.changedFiles].filter((p) => allowlistSet.has(p)).sort();
  if (JSON.stringify(currentChanged) !== JSON.stringify(markerChanged)) {
    fail('the set of changed release files differs from the preflight marker. Re-run: npm run release-preflight');
  }

  // ---- 4. Deployment tooling ----------------------------------------------
  const { cliPath: ghPagesCli, version: ghPagesVersion } = resolveGhPagesCli(root);
  const deployMessage = `Pages deploy ${String(marker.driftFingerprint).slice(0, 8)}`;
  const deployArgs = ['-d', 'dist', '-m', deployMessage];
  log(`[ship] gh-pages CLI: ${ghPagesCli} (v${ghPagesVersion})`);
  log(`[ship] deploy publishes exactly: process.execPath ${JSON.stringify(deployArgs)}`);

  if (allowlistChanges.length === 0) {
    if (verifyOnly) {
      log('[ship] VERIFY-ONLY: nothing to release (clean release scope); deployment skipped.');
      return { ok: true, verifyOnly: true, deployed: false, committed: false };
    }
    log('[ship] no allowlisted changes — deploying the previously validated dist only.');
    execFile(process.execPath, [ghPagesCli, ...deployArgs], { cwd: root, stdio: 'inherit' });
    log('[ship] deployed. GitHub Pages will serve the validated build shortly.');
    log('[ship] DONE.');
    return { ok: true, verifyOnly: false, deployed: true, committed: false };
  }

  if (verifyOnly) {
    log('[ship] VERIFY-ONLY: all release gates passed. Plan (not executed):');
    log('[ship]   deploy:  process.execPath ' + [ghPagesCli, ...deployArgs].join(' '));
    log('[ship]   stage:   git add -- ' + allowlist.join(' '));
    log('[ship]   commit:  git commit -m "Release: validated build ' + String(marker.driftFingerprint).slice(0, 8) + '" -- ' + allowlist.join(' '));
    log('[ship]   push:    git push origin main');
    log('[ship]   excluded from the commit (preserved): ' + (preservedPresent.join(', ') || '(none)'));
    return { ok: true, verifyOnly: true, deployed: false, committed: false, wouldCommit: allowlistChanges };
  }

  // ---- 5. Deploy FIRST — a failure here must leave main untouched ---------
  log('[ship] deploying dist to gh-pages (before any commit/push)...');
  execFile(process.execPath, [ghPagesCli, ...deployArgs], { cwd: root, stdio: 'inherit' });
  log('[ship] deployed.');

  // ---- 6. Stage ONLY the allowlist ----------------------------------------
  git(['add', '--', ...allowlist]);
  const stagedNow = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const stagedOutsideScope = stagedNow.filter((p) => !allowlistSet.has(p) && !authorizedPrestagedSet.has(p));
  if (stagedOutsideScope.length) {
    fail(`unexpected staged content after staging the allowlist: ${stagedOutsideScope.join(', ')} — push aborted.`);
  }
  log('[ship] staged (allowlist only):');
  log(git(['diff', '--cached', '--name-status'])
    .split('\n').filter(Boolean).map((l) => '   ' + l).join('\n'));

  // ---- 7. Pathspec commit — pre-staged non-allowlist content stays out ----
  const commitMessage = `Release: validated build ${String(marker.driftFingerprint).slice(0, 8)} (${new Date(nowMs()).toISOString().slice(0, 10)})`;
  git(['commit', '-m', commitMessage, '--', ...allowlist]);
  log('[ship] committed (pathspec-scoped).');

  // ---- 8. Re-inspect the actual commit before pushing ---------------------
  const committedFiles = git(['show', '--pretty=format:', '--name-only', 'HEAD']).split('\n').filter(Boolean);
  const committedOutside = committedFiles.filter((p) => !allowlistSet.has(p));
  if (committedOutside.length) {
    fail(`release commit unexpectedly contains non-allowlisted file(s): ${committedOutside.join(', ')} — push aborted. ` +
      'Inspect HEAD locally and resolve manually.');
  }
  const stillStaged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const lostPrestaged = prestagedAuthorizedBefore.filter((p) => !stillStaged.includes(p));
  if (lostPrestaged.length) {
    fail(`pre-existing staged content was not preserved after the commit: ${lostPrestaged.join(', ')} — push aborted.`);
  }

  // ---- 9. Push -------------------------------------------------------------
  log('[ship] pushing main...');
  git(['push', 'origin', 'main']);
  log('[ship] pushed.');
  log('[ship] DONE — deployed first, then recorded. main reflects a successful publication.');
  return { ok: true, verifyOnly: false, deployed: true, committed: true, committedFiles };
}
