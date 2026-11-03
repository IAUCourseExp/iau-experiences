/**
 * Single source of truth for the local release pipeline's Git scope.
 *
 * RELEASE_FILES
 *   The exact, closed allowlist of repository paths authorized for the
 *   release commit. `release-ship.mjs` stages ONLY these paths and creates
 *   the commit with a pathspec (`git commit -- <paths>`), so no other staged
 *   or unstaged change can enter it. `release-preflight.mjs` records each
 *   path's content hash in the preflight marker so any post-preflight edit
 *   of a to-be-released file aborts the release.
 *
 * AUTHORIZED_PRESTAGED_PATHS
 *   Paths whose ALREADY-STAGED state may legitimately exist in the index
 *   before a release (a reviewed deletion). The pipeline never stages them
 *   and the pathspec commit EXCLUDES them, leaving them staged afterwards.
 *   Any other pre-staged path aborts the release.
 *
 * PRESERVED_PATHS
 *   Working-tree changes that exist in this workspace but are NOT authorized
 *   for this release. They are left exactly as-is (never staged, never
 *   discarded). Their presence is expected and does not abort; any status
 *   entry outside RELEASE_FILES ∪ PRESERVED_PATHS ∪ AUTHORIZED_PRESTAGED_PATHS
 *   aborts the release.
 */

export const RELEASE_FILES = [
  '.github/workflows/Main.yml',
  'package.json',
  'package-lock.json',
  'scraper.py',
  'src/App.jsx',
  'src/components/ExplorerView.jsx',
  'src/components/ProfilesView.jsx',
  'src/last_update.json',
  'src/lib/profiles.js',
  'tests/e2e/phase2.spec.js',
  'tests/e2e/phase3-matrix.spec.js',
  'tests/unit/profiles-directory.test.js',
  'tests/unit/release-pipeline.test.js',
  'tools/release-allowlist.mjs',
  'tools/release-ship-core.mjs',
  'tools/release-ship.mjs',
  'tools/write-release-time.mjs',
  '.gitignore',
  'eslint.config.js',
  'tools/release-preflight.mjs',
];

export const AUTHORIZED_PRESTAGED_PATHS = [
  'src/derived/atlas.json',
];

export const PRESERVED_PATHS = [
  'EXPERIENCES_PHASE4_AUTONOMOUS_PLATFORM_REPORT.md',
  'EXPERIENCES_PHASE4_FINAL_REMEDIATION_REPORT.md',
  'src/components/ContrastiveExplorer.jsx',
  'tools/nlp_pipeline.py',
];
