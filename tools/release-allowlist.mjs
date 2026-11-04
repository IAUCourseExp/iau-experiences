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
  'src/components/Combobox.jsx',
  'src/components/ExplorerView.jsx',
  'src/components/ProfilesView.jsx',
  'src/components/ViewTabs.jsx',
  'src/last_update.json',
  'src/lib/keywords.js',
  'src/lib/profiles.js',
  'src/lib/search.js',
  'src/derived/atlas-topics.json',
  'src/derived/atlas-neighbors.json',
  'tests/e2e/phase2.spec.js',
  'tests/e2e/phase3-matrix.spec.js',
  'tests/e2e/phase5-ux.spec.js',
  'tests/unit/phase2.test.js',
  'tests/unit/profiles-directory.test.js',
  'tests/unit/release-pipeline.test.js',
  'tests/unit/atlas-artifact.test.js',
  'tests/unit/keywords.test.js',
  'tools/keyword-audit.mjs',
  'tools/nlp_pipeline.py',
  'tools/release-allowlist.mjs',
  'tools/release-ship-core.mjs',
  'tools/release-ship.mjs',
  'tools/write-release-time.mjs',
  '.gitignore',
  'eslint.config.js',
  'vite.config.js',
  'tools/release-preflight.mjs',
];

export const AUTHORIZED_PRESTAGED_PATHS = [
  'src/derived/atlas.json',
];

export const PRESERVED_PATHS = [
  'EXPERIENCES_PHASE4_AUTONOMOUS_PLATFORM_REPORT.md',
  'EXPERIENCES_PHASE4_FINAL_REMEDIATION_REPORT.md',
  'src/components/ContrastiveExplorer.jsx',
  // Pre-existing tracked Python bytecode (committed on origin/main in f42a818).
  // Left exactly as-is here; the owner should untrack it later with
  // `git rm --cached` — .gitignore now prevents it from returning.
  'tools/__pycache__/nlp_pipeline.cpython-312.pyc',
  // tools/nlp_pipeline.py moved to RELEASE_FILES (2026-11 remediation: the
  // corrected pipeline itself is part of the release).
  // Local diagnostic scratch files — kept on disk, never staged, never shipped.
  'eslint-override.js',
  'temp-test-eslint.js',
  'tmp_remote_eslint.config.js',
  'tests/unit/test-imports.test.js',
  'tests/unit/test-imports2.test.js',
  'tests/unit/test-imports3.test.js',
  'tests/unit/test-imports4.test.js',
  'tests/unit/test-minimal.test.js',
  'tools/release-allowlist.js',
  'tools/write-release-time.js',
];
