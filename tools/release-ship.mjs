#!/usr/bin/env node
/**
 * Phase IV release ship — the second half of the owner-run `npm run deploy-all`.
 *
 * Thin CLI wrapper around tools/release-ship-core.mjs (all logic lives there
 * so it can be unit-tested with injected fakes). See that file for the full
 * safety contract. Summary:
 *   - refuses to run without a fresh, hash-complete preflight marker;
 *   - verifies branch/HEAD/remote and every released file hash against the
 *     marker before touching anything;
 *   - never stages outside tools/release-allowlist.mjs RELEASE_FILES and
 *     commits with a pathspec so pre-existing staged content cannot enter;
 *   - deploys dist/ through the locally installed gh-pages CLI via
 *     process.execPath (no npx, no shell, no downloads) BEFORE committing,
 *     so a failed deployment leaves main completely untouched.
 *
 * Set IAU_RELEASE_VERIFY_ONLY=1 to run every gate and print the plan without
 * deploying, staging, committing, or pushing.
 *
 * THE CODING AGENT NEVER EXECUTES THE REAL RELEASE. This script exists for
 * the owner (verify-only runs are safe and were used for validation).
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runShip } from './release-ship-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

try {
  runShip({
    root: ROOT,
    git,
    execFile: (cmd, args, opts) => execFileSync(cmd, args, opts),
    env: process.env,
    nowMs: () => Date.now(),
    log: (...parts) => console.log(...parts),
  });
} catch (err) {
  console.error('SHIP REFUSED: ' + (err && err.message ? err.message : err));
  process.exit(1);
}