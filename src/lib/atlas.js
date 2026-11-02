import { SCHEMA_VERSION } from './schema.js';

/**
 * Semantic Experience Atlas loader (Phase III).
 *
 * The artifacts are produced by tools/nlp_pipeline.py at build time and bind
 * to the exact dataset via manifest.datasetContentChecksum. The frontend
 * recomputes that checksum from the dataset it actually received and refuses
 * to present derived topics on a mismatch — stale artifacts can never be
 * shown as fresh (mission §5). No ML runs in the browser: these are small
 * precomputed JSON files.
 */

let topicsPromise = null;
let neighborsPromise = null;

export function loadTopicsArtifact() {
  if (!topicsPromise) {
    topicsPromise = import('../derived/atlas-topics.json')
      .then((m) => m.default)
      .catch((err) => {
        topicsPromise = null; // allow retry after a transient failure
        throw err;
      });
  }
  return topicsPromise;
}

export function loadNeighborsArtifact() {
  if (!neighborsPromise) {
    neighborsPromise = import('../derived/atlas-neighbors.json')
      .then((m) => m.default)
      .catch((err) => {
        neighborsPromise = null;
        throw err;
      });
  }
  return neighborsPromise;
}

/**
 * Verify an artifact against the dataset the app actually received.
 * Binding key: the drift fingerprint (browser-recomputable FNV over the
 * canonical bytes). The SHA-256 provenance fingerprint is additionally
 * recorded in the manifest for build-side verification.
 * @returns {{ bound: boolean, reason?: string, mode?: string }}
 */
export function bindArtifact(artifact, driftFingerprint) {
  if (!artifact || !artifact.manifest || typeof artifact.manifest.datasetDriftFingerprint !== 'string') {
    return { bound: false, reason: 'malformed-artifact' };
  }
  if (artifact.manifest.schemaVersion !== SCHEMA_VERSION) {
    return { bound: false, reason: 'schema-version-mismatch' };
  }
  if (artifact.manifest.datasetDriftFingerprint !== driftFingerprint) {
    return { bound: false, reason: 'dataset-checksum-mismatch' };
  }
  if (artifact.manifest.mode !== 'semantic' && artifact.manifest.mode !== 'lexical-fallback') {
    return { bound: false, reason: 'unknown-mode' };
  }
  return { bound: true, mode: artifact.manifest.mode };
}

/**
 * Neighbor list for one record, or null when the artifact is unavailable/
 * unbound. Neighbor scores are ordinal hints — the UI must not present them
 * as probabilities or percentages.
 */
export function neighborsFor(artifact, recordId) {
  if (!artifact || !artifact.neighbors) return null;
  const list = artifact.neighbors[String(recordId)];
  return Array.isArray(list) ? list : null;
}
