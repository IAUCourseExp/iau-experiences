import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  runShip,
  resolveGhPagesCli,
  computeDirHash,
  ShipError,
  sha256File,
} from '../../tools/release-ship-core.mjs';
import { getTehranTimestamp } from '../../tools/write-release-time.mjs';
import {
  RELEASE_FILES,
  AUTHORIZED_PRESTAGED_PATHS,
  PRESERVED_PATHS,
} from '../../tools/release-allowlist.mjs';

const HEAD_SHA = 'a'.repeat(40);
const DRIFT = '44bc29cfd40ad12a';
const REMOTE = 'https://github.com/IAUCourseExp/iau-experiences.git';
const NOW = 1_800_000_000_000;

/**
 * Join a repository-relative fixture path onto a temp root, refusing any
 * path that would escape the root. All inputs come from the hardcoded
 * allowlist constants in this file — this guard is defense in depth.
 */
function safeJoin(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`fixture path escapes the temp root: ${relativePath}`);
  }
  return resolved;
}

const tempRoots = [];
afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot({ withGhPages = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
  tempRoots.push(root);

  const write = (relativePath, content) => {
    const abs = safeJoin(root, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  // Write every fixture file FIRST, then hash from disk — some paths
  // (scraper.py, src/last_update.json) are both protected and releasable,
  // so hashing during the writes would record pre-overwrite values.
  write('scraper.py', 'SCRAPER\n');
  write('src/data.json', '[]\n');
  write('src/last_update.json', '{"last_update": "2026/11/03 - 10:00"}\n');
  write('package.json', '{}\n');
  write('package-lock.json', '{}\n');
  write('.github/workflows/Main.yml', 'workflow\n');
  write('src/derived/atlas-topics.json', JSON.stringify({ manifest: { datasetDriftFingerprint: DRIFT } }));
  write('dist/index.html', '<html></html>');
  write('dist/assets/atlas-topics.js', 'T');
  write('dist/assets/atlas-neighbors.js', 'N');
  for (const rel of RELEASE_FILES) {
    write(rel, `content of ${rel}\n`);
  }
  if (withGhPages) {
    write('node_modules/gh-pages/package.json', JSON.stringify({ version: '6.3.0' }));
    write('node_modules/gh-pages/bin/gh-pages.js', '#!/usr/bin/env node\n');
  }

  const protectedHashes = {
    scraper: sha256File(safeJoin(root, 'scraper.py')),
    data: sha256File(safeJoin(root, 'src/data.json')),
    lastUpdate: sha256File(safeJoin(root, 'src/last_update.json')),
  };
  const packageJsonHash = sha256File(safeJoin(root, 'package.json'));
  const packageLockHash = sha256File(safeJoin(root, 'package-lock.json'));
  const workflowHash = sha256File(safeJoin(root, '.github/workflows/Main.yml'));
  const distHash = computeDirHash(path.join(root, 'dist'));
  const releaseFileHashes = {};
  for (const rel of RELEASE_FILES) {
    releaseFileHashes[rel] = sha256File(safeJoin(root, rel));
  }

  const marker = {
    passedAt: NOW,
    driftFingerprint: DRIFT,
    commit: HEAD_SHA,
    branch: 'main',
    remoteUrl: REMOTE.replace(/\.git$/, ''),
    dirty: true,
    changedFiles: RELEASE_FILES,
    protectedHashes,
    packageLockHash,
    packageJsonHash,
    workflowHash,
    distHash,
    releaseFileHashes,
    toolVersion: '1.1.0',
    maxAgeMs: 2 * 60 * 60 * 1000,
  };
  write(path.join('audit-artifacts', 'preflight-passed.json'), JSON.stringify(marker, null, 2));
  return { root, marker };
}

/**
 * Fake git runner. Records every invocation and answers the read-only
 * commands the pipeline issues. Write commands are only recorded.
 */
function makeGitFake({ statusLines = [], cachedLines = null } = {}) {
  const calls = [];
  let committed = false;
  const fn = (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (key === 'rev-parse --is-inside-work-tree') return 'true';
    if (key === 'rev-parse --abbrev-ref HEAD') return 'main';
    if (key === 'rev-parse HEAD') return HEAD_SHA;
    if (key === 'remote get-url origin') return REMOTE;
    if (key === 'status --porcelain') return statusLines.join('\n');
    if (key === 'diff --cached --name-only') {
      if (committed) {
        return cachedLines
          ? cachedLines.filter((p) => AUTHORIZED_PRESTAGED_PATHS.includes(p)).join('\n')
          : '';
      }
      return cachedLines ? cachedLines.join('\n') : '';
    }
    if (args[0] === 'add') { return ''; }
    if (args[0] === 'commit') { committed = true; return ''; }
    if (key === 'show --pretty=format: --name-only HEAD') {
      return committed
        ? statusLines.map((l) => l.slice(3)).filter((p) => RELEASE_FILES.includes(p)).join('\n')
        : '';
    }
    if (args[0] === 'push') return '';
    return '';
  };
  fn.calls = calls;
  fn.wrote = () => calls.filter((c) => ['add', 'commit', 'push'].includes(c[0]));
  return fn;
}

function makeExecFake({ failDeploy = false } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (failDeploy) throw new Error('spawnSync EINVAL (simulated)');
  };
  fn.calls = calls;
  return fn;
}

function baseIo(root, git, execFile, env = {}) {
  return {
    root,
    git,
    execFile,
    env,
    nowMs: () => NOW + 1000,
    log: () => {},
  };
}

describe('gh-pages CLI resolution', () => {
  it('aborts before any git activity when the local gh-pages dependency is missing', (_) => {
    const { root } = makeRoot({ withGhPages: false });
    const git = makeGitFake();
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /gh-pages CLI was not found/);
    // No git WRITE of any kind happened (read-only lookups are harmless).
    expect(git.wrote()).toHaveLength(0);
  });

  it('resolves the local JavaScript entry point under node_modules', (_) => {
    const { root } = makeRoot();
    const { cliPath, version } = resolveGhPagesCli(root);
    expect(cliPath).toBe(path.join(root, 'node_modules', 'gh-pages', 'bin', 'gh-pages.js'));
    expect(version).toBe('6.3.0');
  });
});

describe('release pipeline (runShip)', () => {
it('happy path: deploys first via process.execPath with -d dist, then stages exactly the allowlist, commits with a pathspec, and pushes', (t) => {
    const { root } = makeRoot(t);
    const statusLines = RELEASE_FILES.map((p) => ` M ${p}`);
    statusLines.push(`D  ${AUTHORIZED_PRESTAGED_PATHS[0]}`);
    statusLines.push(' D src/components/ContrastiveExplorer.jsx');
    statusLines.push('?? EXPERIENCES_PHASE4_AUTONOMOUS_PLATFORM_REPORT.md');
    const git = makeGitFake({ statusLines, cachedLines: [AUTHORIZED_PRESTAGED_PATHS[0]] });
    const exec = makeExecFake();

    const result = runShip(baseIo(root, git, exec));

    expect(result).toEqual({
      ok: true,
      verifyOnly: false,
      deployed: true,
      committed: true,
      committedFiles: RELEASE_FILES,
    });
    // Deployment ran first, through Node itself, publishing exactly dist/.
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].cmd).toBe(process.execPath);
    expect(path.basename(exec.calls[0].args[0])).toBe('gh-pages.js');
    expect(exec.calls[0].args.slice(1)).toEqual(['-d', 'dist', '-m', `Pages deploy ${DRIFT.slice(0, 8)}`]);
    expect(exec.calls[0].opts).toEqual({ cwd: root, stdio: 'inherit' });
    // Deployment happened before any git write.
    const firstGitWrite = git.calls.findIndex((c) => ['add', 'commit', 'push'].includes(c[0]));
    expect(firstGitWrite).toBeGreaterThan(0);
    expect(git.calls.slice(0, firstGitWrite).every((c) => c[0] !== 'add' && c[0] !== 'commit' && c[0] !== 'push')).toBe(true);
    // Staging is pathspec-scoped to the allowlist.
    const addCall = git.calls.find((c) => c[0] === 'add');
    expect(addCall[1]).toBe('--');
    expect(addCall.slice(2)).toEqual(RELEASE_FILES);
    // The commit carries the allowlist pathspec, excluding the pre-staged deletion.
    const commitCall = git.calls.find((c) => c[0] === 'commit');
    expect(commitCall[1]).toBe('-m');
    expect(commitCall[commitCall.length - 1 - RELEASE_FILES.length]).toBe('--');
    expect(commitCall.slice(commitCall.length - RELEASE_FILES.length)).toEqual(RELEASE_FILES);
    // Push happens last.
    expect(git.calls[git.calls.length - 1]).toEqual(['push', 'origin', 'main']);
  });

it('excludes preserved and unrelated untracked files from staging', (_) => {
    const { root } = makeRoot();
    const statusLines = [
      ...RELEASE_FILES.map((p) => ` M ${p}`),
      ' M tools/nlp_pipeline.py',
      '?? EXPERIENCES_PHASE4_AUTONOMOUS_PLATFORM_REPORT.md',
      '?? EXPERIENCES_PHASE4_FINAL_REMEDIATION_REPORT.md',
    ];
    const git = makeGitFake({ statusLines });
    runShip(baseIo(root, git, makeExecFake()));
    const addCall = git.calls.find((c) => c[0] === 'add');
    const stagedPaths = addCall.slice(2);
    expect(stagedPaths).not.toContain('tools/nlp_pipeline.py');
    expect(stagedPaths).not.toContain('EXPERIENCES_PHASE4_AUTONOMOUS_PLATFORM_REPORT.md');
    expect(stagedPaths).not.toContain('EXPERIENCES_PHASE4_FINAL_REMEDIATION_REPORT.md');
    expect(stagedPaths).toEqual(RELEASE_FILES);
  });

  it('aborts when an unknown working-tree change exists outside the allowlist and preserved set', (_) => {
    const { root } = makeRoot();
    const git = makeGitFake({ statusLines: [' M some-random-file.txt'] });
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /unexpected working-tree change/);
    expect(git.wrote()).toHaveLength(0);
  });

  it('aborts when unexpected content is already staged, and never discards it', (_t) => {
    const { root } = makeRoot();
    const git = makeGitFake({
      statusLines: [` M ${RELEASE_FILES[0]}`],
      cachedLines: ['someone-else-staged.txt'],
    });
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /unexpected pre-staged content/);
    expect(git.wrote()).toHaveLength(0);
    expect(git.calls.filter((c) => c[0] === 'add' || c[0] === 'reset' || c[0] === 'restore')).toHaveLength(0);
  });

  it('deployment failure aborts before any staging, commit, or push', (_t) => {
    const { root, marker } = makeRoot();
    const git = makeGitFake({ statusLines: RELEASE_FILES.map((p) => ` M ${p}`) });
    const exec = makeExecFake({ failDeploy: true });
    // eslint-disable-next-line no-console
    console.log('DBG marker.scraper =', marker.protectedHashes.scraper,
      '| disk =', crypto.createHash('sha256').update(fs.readFileSync(safeJoin(root, 'scraper.py'))).digest('hex'),
      '| markerFile =', JSON.parse(fs.readFileSync(safeJoin(root, path.join('audit-artifacts', 'preflight-passed.json')), 'utf8')).protectedHashes.scraper);
    expect(() => runShip(baseIo(root, git, exec))).toThrow(/EINVAL/);
    expect(exec.calls).toHaveLength(1);
    expect(git.wrote()).toHaveLength(0);
  });

  it('aborts on a stale preflight marker', () => {
    const { root, marker } = makeRoot();
    marker.passedAt = NOW - 3 * 60 * 60 * 1000;
    fs.writeFileSync(safeJoin(root, path.join('audit-artifacts', 'preflight-passed.json')), JSON.stringify(marker));
    const git = makeGitFake();
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /older than the allowed window/);
    expect(git.wrote()).toHaveLength(0);
  });

  it('aborts on a marker missing the hardened fields (older tool version)', () => {
    const { root, marker } = makeRoot();
    delete marker.releaseFileHashes;
    delete marker.distHash;
    fs.writeFileSync(safeJoin(root, path.join('audit-artifacts', 'preflight-passed.json')), JSON.stringify(marker));
    const git = makeGitFake();
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /missing required field/);
  });

  it('aborts when a release file changed after preflight', (_t) => {
    const { root } = makeRoot();
    fs.writeFileSync(safeJoin(root, 'src/lib/profiles.js'), 'tampered\n');
    const git = makeGitFake({ statusLines: [' M src/lib/profiles.js'] });
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /release file changed since preflight: src\/lib\/profiles\.js/);
    expect(git.wrote()).toHaveLength(0);
  });

  it('aborts when the dist build output changed after preflight', (_t) => {
    const { root } = makeRoot();
    fs.writeFileSync(safeJoin(root, 'dist/index.html'), '<html>tampered</html>');
    const git = makeGitFake({ statusLines: RELEASE_FILES.map((p) => ` M ${p}`) });
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /dist\/ changed since preflight/);
    expect(git.wrote()).toHaveLength(0);
  });

  it('aborts when HEAD changed since preflight', (_t) => {
    const { root } = makeRoot();
    const inner = makeGitFake();
    const git = (args) => {
      if (args.join(' ') === 'rev-parse HEAD') return 'b'.repeat(40);
      return inner(args);
    };
    expect(() => runShip(baseIo(root, git, makeExecFake())))
      .toThrow(ShipError, /HEAD changed since preflight/);
  });

  it('verify-only mode runs every gate, touches nothing, and reports the exact plan', (_t) => {
    const { root } = makeRoot();
    const statusLines = RELEASE_FILES.map((p) => ` M ${p}`);
    const git = makeGitFake({ statusLines, cachedLines: [AUTHORIZED_PRESTAGED_PATHS[0]] });
    const exec = makeExecFake();
    const result = runShip(baseIo(root, git, exec, { IAU_RELEASE_VERIFY_ONLY: '1' }));
    expect(result).toEqual({ ok: true, verifyOnly: true, deployed: false, committed: false, wouldCommit: RELEASE_FILES });
    expect(exec.calls).toHaveLength(0);
    expect(git.wrote()).toHaveLength(0);
  });

  it('preserved files are reported and never staged', (_t) => {
    const { root, marker: _marker } = makeRoot();
    // The marker expects ALL RELEASE_FILES as changedFiles.
    // We must include ALL RELEASE_FILES + PRESERVED_PATHS in status to pass the
    // changed-files check while still verifying preserved files are not staged.
    const statusLines = [
      ...RELEASE_FILES.map((p) => ` M ${p}`),
      ...PRESERVED_PATHS.map((p) => ` M ${p}`),
    ];
    const git = makeGitFake({ statusLines });
    runShip(baseIo(root, git, makeExecFake()));
    const addCall = git.calls.find((c) => c[0] === 'add');
    for (const preserved of PRESERVED_PATHS) {
      expect(addCall.slice(2)).not.toContain(preserved);
    }
  });
});

describe('Tehran timestamp generation', () => {
  it('formats a fixed instant in Asia/Tehran as YYYY/MM/DD - HH:MM', () => {
    // 2026-01-15T10:20:30Z == 13:50 Tehran (fixed UTC+03:30 offset).
    expect(getTehranTimestamp(new Date('2026-01-15T10:20:30Z'))).toBe('2026/01/15 - 13:50');
  });

  it('formats a mid-year instant consistently with the fixed offset', () => {
    // 2026-07-01T19:35:00Z == 23:05 Tehran (Iran has no DST since 2022).
    expect(getTehranTimestamp(new Date('2026-07-01T19:35:00Z'))).toBe('2026/07/01 - 23:05');
  });
});
