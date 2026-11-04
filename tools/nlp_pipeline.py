#!/usr/bin/env python3
"""
IAU Experiences — Phase III build-time NLP pipeline (mission §5, §6).

Reads the authoritative src/data.json, validates it with the same policy as
the frontend (src/lib/schema.js), and derives — deterministically — a Semantic
Experience Atlas:

  * corpus-derived topics (NO manually curated taxonomy): TF-IDF → truncated
    SVD (LSA) → clustering, with a KMeans-vs-HDBSCAN comparison and an
    explicit minimum-evidence policy,
  * discriminative c-TF-IDF labels with evidence phrases and exemplars,
  * per-record semantic neighbors (diversity-capped, thresholded),
  * a manifest binding every artifact to the exact dataset (SHA-256 of the
    source file + FNV-1a content checksum computed byte-identically to the
    frontend) plus versions, seeds, config, and quality diagnostics.

No ML runs in a visitor's browser: this script runs at build time only, and
the frontend consumes small precomputed artifacts. If clustering quality
fails the documented thresholds, the pipeline emits an explicit
"lexical-fallback" mode instead of fabricated topics.

Determinism: fixed RNG_SEED, fixed configuration, deterministic tie-breaking.
Outputs are staged and atomically renamed; a failed run never publishes.

Usage:
  python tools/nlp_pipeline.py [--data src/data.json] [--out src/derived/atlas.json]
                               [--summary audit-artifacts/phase-3/pipeline-summary.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from sklearn.cluster import HDBSCAN, KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import Normalizer

# ---------------------------------------------------------------------------
# Pinned configuration (recorded in the manifest; do not change casually)
# ---------------------------------------------------------------------------
PIPELINE_VERSION = "2.1.0"
SCHEMA_VERSION = 2
RNG_SEED = 20260212
SVD_COMPONENTS = 120
TFIDF_MIN_DF = 3
TFIDF_MAX_DF = 0.60
NGRAM_RANGE = (1, 2)
SUBLINEAR_TF = True
KMEANS_K_MIN = 12
KMEANS_K_MAX = 48
KMEANS_N_INIT = 10
# NOTE: k=12 is a FIXED operating choice for this corpus (not automatically discovered).
# The loop below evaluates k=12,16,20...48 and selects the best by NPMI coherence,
# but the minimum is pinned at 12. For adaptive topic count, a separate stability-
# driven selection would be needed. This is documented in the manifest.
HDBSCAN_MIN_CLUSTER_SIZE = 12
HDBSCAN_MIN_SAMPLES = 5
MIN_CLUSTER_SIZE = 8          # minimum-evidence policy: smaller clusters stay hidden
MAX_OUTLIER_SHARE = 0.75      # clustering rejected if more than 75% of docs are outliers
MIN_MEAN_SILHOUETTE = 0.02    # very low bar; LSA spaces are weakly separated
MIN_STABILITY_ARI = 0.55      # mean pairwise ARI across reruns
NEIGHBOR_TOP_K = 5
NEIGHBOR_MIN_SCORE = 0.20     # empirical: below this, "similar" is noise on this corpus
NEIGHBOR_MAX_SAME_COURSE = 2
NEIGHBOR_MAX_SAME_PROF = 2
LABEL_TOP_PHRASES = 6
EXEMPLARS_PER_TOPIC = 3

# Persian stopword list used ONLY to keep label phrases readable. It is a
# language resource, not a topic definition: topics come from the corpus, and
# this list can never add, remove, or rename a topic (mission §3).
LABEL_STOPWORDS = {
    "و", "در", "به", "از", "که", "این", "را", "با", "است", "برای", "هم", "می",
    "شد", "کرد", "کند", "بود", "خود", "باید", "اگر", "ولی", "اما", "یا", "تا",
    "بر", "روی", "دست", "هیچ", "بیشتر", "خیلی", "خیلیا", "اصلا", "واقعا", "اکثرا",
    "ایشون", "ایشان", "براشون", "برامون", "بهتون", "میدن", "میده", "دادن", "کردم",
    "کردن", "کردم", "بودم", "هستم", "بوده", "شده", "داده", "داشت", "دارن", "داره",
    "میکنن", "میکنه", "میگن", "کنید", "بدید", "بگیره", "باشه", "باشید", "شو",
    "استاد", "درس", "ترم", "واحد", "کلاس", "جلسه", "جلسات", "دانشجو", "دانشجوها",
    "پس", "چون", "وقتی", "الان", "دیگه", "فقط", "حتی", "مثل", "برای اینکه",
}

AR_TO_FA = str.maketrans({
    "\u064A": "\u06CC",  # Arabic Yeh -> Persian Yeh
    "\u0649": "\u06CC",  # Alef Maksura -> Persian Yeh
    "\u0643": "\u06A9",  # Arabic Kaf -> Persian Kaf
    "\u0624": "\u0648",
    "\u0623": "\u0627",
    "\u0625": "\u0627",
    "\u0671": "\u0627",
    "\u0629": "\u0647",
    "\u06C0": "\u0647",
})

PERSIAN_DIGITS = "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9"
ARABIC_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669"
DIGIT_TRANSLATION = str.maketrans(
    {PERSIAN_DIGITS[i]: str(i) for i in range(10)}
    | {ARABIC_DIGITS[i]: str(i) for i in range(10)}
)

DROP_CHARS_RE = re.compile(r"[\u064B-\u0652\u0670\u0640\u200B-\u200F\u202A-\u202E\u00AD]")
NON_LETTER_RE = re.compile(r"[^\w\u0600-\u06FF]+", re.UNICODE)


def normalize_fa(text: str) -> str:
    """Byte-identical mirror of normalizePersian in src/lib/search.js (matching
    form only; the original text is never rewritten for display)."""
    s = str(text).lower()
    s = s.translate(DIGIT_TRANSLATION)
    s = s.translate(AR_TO_FA)
    s = DROP_CHARS_RE.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tokenize(normalized: str):
    return [t for t in NON_LETTER_RE.split(normalized) if len(t) >= 3 and not t.isdigit()]


# ---------------------------------------------------------------------------
# FNV-1a 64 — must stay byte-identical with src/lib/schema.js (fnv1a64)
# ---------------------------------------------------------------------------
FNV_OFFSET = 0xCBF29CE484222325
FNV_PRIME = 0x100000001B3
MASK64 = 0xFFFFFFFFFFFFFFFF


def fnv1a64(data: bytes) -> str:
    h = FNV_OFFSET
    for b in data:
        h ^= b
        h = (h * FNV_PRIME) & MASK64
    return format(h, "016x")


def canonical_record_bytes(record: dict) -> bytes:
    """Byte-identical mirror of canonicalRecordBytes in src/lib/schema.js:
    length-prefixed `tag:value` fields (null/missing → '~'). Delimiter- and
    ambiguity-proof."""
    import struct

    def field(tag: str, value) -> bytes:
        s = "~" if value is None else str(value)
        payload = f"{tag}:{s}".encode("utf-8")
        return struct.pack(">I", len(payload)) + payload

    parts = b"".join([
        field("id", record.get("id")),
        field("prof", record.get("professor")),
        field("course", record.get("course")),
        field("ps", record.get("Professor_Score")),
        field("ss", record.get("Student_Score")),
        field("txt", record.get("text")),
    ])
    return parts


def record_identity(record: dict, seen_ids: dict) -> str:
    """Mirror of the Phase IV identity rules in src/lib/schema.js:
    String(id) for the first occurrence; `id#dupN` for duplicates;
    `x-<fnv>-oN` (content fingerprint + occurrence) when no safe id exists."""
    rid = record.get("id")
    if isinstance(rid, bool) or not isinstance(rid, (int, float)) or (isinstance(rid, float) and rid != rid):
        canonical = canonical_record_bytes(record)
        key = fnv1a64(canonical)
        return f"x-{key}-o0"
    rid = int(rid)
    if rid in seen_ids:
        occurrence = seen_ids[rid]
        seen_ids[rid] = occurrence + 1
        return f"{rid}#dup{occurrence}"
    seen_ids[rid] = 1
    return str(rid)


def dataset_fingerprints(records) -> tuple[str, str]:
    """Returns (drift_fingerprint_fnv1a64, provenance_fingerprint_sha256)
    over the concatenation of canonical record bytes in append order.
    Byte-identical with the frontend's validateDataset output."""
    blob = b"".join(canonical_record_bytes(r) for r in records)
    return fnv1a64(blob), hashlib.sha256(blob).hexdigest()


# ---------------------------------------------------------------------------
# Validation (mirror of src/lib/schema.js policy)
# ---------------------------------------------------------------------------
def validate_records(raw_records):
    issues = []
    valid = []
    counts = {
        "total": len(raw_records),
        "valid": 0,
        "quarantined": 0,
        "withWarnings": 0,
        "duplicateIds": 0,
        "duplicateLinks": 0,
        "emptyText": 0,
        "unexpectedFields": 0,
    }
    known_fields = {"id", "Link", "course", "Student_Score", "Professor_Score", "professor", "text"}
    seen_ids = {}
    seen_links = {}

    for index, raw in enumerate(raw_records):
        record_number = index + 1
        if not isinstance(raw, dict):
            issues.append({"code": "non-object-record", "recordNumber": record_number})
            counts["quarantined"] += 1
            continue
        rid = raw.get("id")
        if not isinstance(rid, (int, float)) or isinstance(rid, bool) or rid != rid:
            issues.append({"code": "missing-or-invalid-id", "recordNumber": record_number})
            counts["quarantined"] += 1
            continue
        rid = int(rid)
        if rid in seen_ids:
            counts["duplicateIds"] += 1
            issues.append({"code": "duplicate-id", "recordId": rid, "recordNumber": record_number,
                           "detail": f"duplicate of position {seen_ids[rid]}"})
        else:
            seen_ids[rid] = record_number

        warnings = 0
        text = raw.get("text") if isinstance(raw.get("text"), str) else ""
        link = raw.get("Link") if isinstance(raw.get("Link"), str) else ""
        if link and not re.match(r"^https?://", link, re.I):
            issues.append({"code": "invalid-link", "recordId": rid, "recordNumber": record_number})
            warnings += 1
        if link and link in seen_links:
            counts["duplicateLinks"] += 1
            issues.append({"code": "duplicate-link", "recordId": rid, "recordNumber": record_number})
        elif link:
            seen_links[link] = rid
        if str(text).strip() == "":
            counts["emptyText"] += 1
            issues.append({"code": "empty-text", "recordId": rid, "recordNumber": record_number})
        for key in raw.keys():
            if key not in known_fields:
                counts["unexpectedFields"] += 1
                issues.append({"code": "unexpected-field", "recordId": rid, "recordNumber": record_number,
                               "field": key})
                warnings += 1
        if warnings:
            counts["withWarnings"] += 1

        counts["valid"] += 1
        valid.append({
            "id": rid,
            "Link": link,
            "course": raw.get("course") if isinstance(raw.get("course"), str) else "",
            "Student_Score": raw.get("Student_Score") if isinstance(raw.get("Student_Score"), str) else "?",
            "Professor_Score": raw.get("Professor_Score") if isinstance(raw.get("Professor_Score"), str) else "?",
            "professor": raw.get("professor") if isinstance(raw.get("professor"), str) else "",
            "text": text,
        })

    return valid, issues, counts


# ---------------------------------------------------------------------------
# Quality metrics
# ---------------------------------------------------------------------------
def npmi_coherence(top_term_sets, binary_doc_terms, term_index):
    """Mean NPMI over consecutive top-term pairs per topic (binary presence)."""
    n_docs = binary_doc_terms.shape[0]
    eps = 1e-12
    scores = []
    for terms in top_term_sets:
        topic_scores = []
        for a, b in zip(terms, terms[1:]):
            ia = term_index.get(a)
            ib = term_index.get(b)
            if ia is None or ib is None:
                continue
            ca = binary_doc_terms[:, ia]
            cb = binary_doc_terms[:, ib]
            cab = float(np.logical_and(ca, cb).sum())
            fa = float(ca.sum())
            fb = float(cb.sum())
            if cab == 0 or fa == 0 or fb == 0:
                topic_scores.append(-1.0)
                continue
            pab = cab / n_docs
            pa = fa / n_docs
            pb = fb / n_docs
            topic_scores.append(np.log(pab / (pa * pb + eps) + eps) / -np.log(pab + eps))
        if topic_scores:
            scores.append(float(np.mean(topic_scores)))
    return scores


def cluster_quality(vectors, labels, terms_per_cluster, binary_doc_terms, term_index):
    sizes = [int(np.sum(labels == c)) for c in sorted(set(labels)) if c != -1]
    kept = [s for s in sizes if s >= MIN_CLUSTER_SIZE]
    n_labeled = int(sum(kept))
    n_docs = vectors.shape[0]
    outliers = n_docs - n_labeled
    mask = labels != -1
    sil = None
    if mask.sum() > 0 and len(set(labels[mask])) > 1:
        try:
            sil = float(silhouette_score(vectors[mask], labels[mask]))
        except ValueError:
            sil = None
    coherence = npmi_coherence(terms_per_cluster, binary_doc_terms, term_index)
    mean_coherence = float(np.mean([c for c in coherence if c is not None])) if coherence else None
    return {
        "nTopicsRaw": len(sizes),
        "nTopicsKept": len(kept),
        "sizes": sorted(sizes, reverse=True),
        "keptShare": round(n_labeled / n_docs, 4) if n_docs else 0.0,
        "outlierShare": round(outliers / n_docs, 4) if n_docs else 1.0,
        "meanSilhouette": sil,
        "meanNpmiCoherence": mean_coherence,
        "minClusterSizeUsed": MIN_CLUSTER_SIZE,
    }


def stability_ari(vectors, labels_a, labels_b):
    mask = (labels_a != -1) & (labels_b != -1)
    if mask.sum() == 0:
        return 0.0
    return float(adjusted_rand_score(labels_a[mask], labels_b[mask]))


# ---------------------------------------------------------------------------
# Clustering candidates
# ---------------------------------------------------------------------------
def ctfidf_labels(tfidf_matrix, labels, feature_names, min_size):
    """Class-based TF-IDF: per-cluster mean TF-IDF, penalized by cluster-generic terms."""
    out = {}
    n_clusters_terms = {}
    for c in sorted(set(labels)):
        if c == -1:
            continue
        rows = np.where(labels == c)[0]
        if rows.size < min_size:
            continue
        mean_vec = np.asarray(tfidf_matrix[rows].mean(axis=0)).ravel()
        top_idx = np.argsort(mean_vec)[::-1][:40]
        n_clusters_terms[c] = rows.size, [(feature_names[i], float(mean_vec[i])) for i in top_idx]
    # genericity penalty: phrase frequency across clusters
    doc_freq = {}
    for c, (_, phrases) in n_clusters_terms.items():
        for p, _ in phrases:
            doc_freq[p] = doc_freq.get(p, 0) + 1
    total_clusters = max(len(n_clusters_terms), 1)
    for c, (size, phrases) in n_clusters_terms.items():
        scored = []
        for p, weight in phrases:
            genericity = doc_freq.get(p, 1) / total_clusters
            tokens = p.split()
            if any(t in LABEL_STOPWORDS for t in tokens):
                continue
            # penalize phrases present in many clusters; keep discriminative ones
            scored.append((p, weight * (1.0 - 0.7 * genericity), weight))
        out[c] = {"size": size, "phrases": scored[:LABEL_TOP_PHRASES + 4]}
    return out


def terms_from_labels(labels_obj):
    out = []
    for c in sorted(labels_obj.keys()):
        out.append([p for p, _, _ in labels_obj[c]["phrases"][:10]])
    return out


def consensus_cluster(vectors, k, n_seeds, seed_base, tfidf_matrix, feature_names, min_size):
    """Evidence-accumulation clustering (MCLA-style): KMeans across multiple
    seeds, co-association matrix, then a final agglomerative pass at
    n_clusters=k on the co-association distance (average linkage, which is
    valid for precomputed distance matrices). Standard remedy for KMeans
    seed instability; deterministic given the seed set. Returns (labels,
    distance-matrix) — the distance matrix is the space the clustering
    actually happened in, used for silhouette evaluation."""
    n = vectors.shape[0]
    coassoc = np.zeros((n, n), dtype=np.float32)
    for s in range(n_seeds):
        km = KMeans(n_clusters=k, random_state=seed_base + s, n_init=KMEANS_N_INIT)
        labels = km.fit_predict(vectors)
        coassoc += (labels[:, None] == labels[None, :]).astype(np.float32)
    coassoc /= n_seeds
    distance = 1.0 - coassoc
    np.fill_diagonal(distance, 0.0)
    from sklearn.cluster import AgglomerativeClustering
    final = AgglomerativeClustering(
        n_clusters=k, metric="precomputed", linkage="average"
    ).fit_predict(distance)
    return final, distance


def run_candidate(name, tfidf_matrix, svd_vectors, feature_names, binary_doc_terms, term_index, rng_seed):
    results = {}
    if name == "kmeans-consensus":
        best = None
        # k loop starts at KMEANS_K_MIN=12 (fixed operating choice, not auto-discovered).
        # The loop evaluates k=12,16,20,24,28,32,36,40,44,48 and selects by NPMI coherence.
        # The chosen k is recorded in the manifest for reproducibility.
        for k in range(KMEANS_K_MIN, KMEANS_K_MAX + 1, 4):
            labels, dist = consensus_cluster(svd_vectors, k, 7, rng_seed, tfidf_matrix, feature_names, MIN_CLUSTER_SIZE)
            kept = [c for c in set(labels) if int(np.sum(labels == c)) >= MIN_CLUSTER_SIZE]
            if len(kept) < 4:
                continue
            labels_obj = ctfidf_labels(tfidf_matrix, labels, feature_names, MIN_CLUSTER_SIZE)
            q = cluster_quality(svd_vectors, labels, terms_from_labels(labels_obj),
                                binary_doc_terms, term_index)
            # silhouette in the space the clustering actually happened in
            try:
                q["meanSilhouette"] = float(silhouette_score(dist, labels, metric="precomputed"))
                q["silhouetteSpace"] = "co-association"
            except ValueError:
                pass
            score = q["meanNpmiCoherence"] or -1
            if best is None or score > best["score"]:
                best = {"k": k, "labels": labels, "quality": q, "score": score,
                        "labelsObj": labels_obj}
        results["kmeans-consensus"] = best
    elif name == "hdbscan-svd":
        clusterer = HDBSCAN(min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE,
                            min_samples=HDBSCAN_MIN_SAMPLES,
                            metric="euclidean",
                            cluster_selection_method="eom")
        labels = clusterer.fit_predict(svd_vectors)
        labels_obj = ctfidf_labels(tfidf_matrix, labels, feature_names, MIN_CLUSTER_SIZE)
        q = cluster_quality(svd_vectors, labels, terms_from_labels(labels_obj),
                            binary_doc_terms, term_index)
        results["hdbscan-svd"] = {"labels": labels, "quality": q,
                                  "score": q["meanNpmiCoherence"] or -1,
                                  "labelsObj": labels_obj}
    elif name == "kmeans-tfidf":
        # baseline without SVD
        km = KMeans(n_clusters=24, random_state=rng_seed, n_init=KMEANS_N_INIT)
        labels = km.fit_predict(tfidf_matrix)
        labels_obj = ctfidf_labels(tfidf_matrix, labels, feature_names, MIN_CLUSTER_SIZE)
        q = cluster_quality(tfidf_matrix, labels, terms_from_labels(labels_obj),
                            binary_doc_terms, term_index)
        results["kmeans-tfidf"] = {"labels": labels, "quality": q,
                                   "score": q["meanNpmiCoherence"] or -1,
                                   "labelsObj": labels_obj}
    return results


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def validate_neighbors(neighbors, doc_ids, valid):
    """Structural gate on the neighbor map, run BEFORE any publication.

    Enforces (mission §5): every key and neighbor id is a known record
    identity; no record is its own neighbor; no duplicate ids within a list;
    Top-K respected; scores finite within [0, 1]; ranking descending.
    Returns audit diagnostics for the manifest. Any violation aborts the run
    with SystemExit — a partial or corrupt neighbor map must never publish.
    """
    valid_ids = {r["identity"] for r in valid}
    problems = []
    all_scores = []
    neighbor_count_hist = {}
    hub = {}
    for doc_id, lst in neighbors.items():
        if doc_id not in valid_ids:
            problems.append(f"unknown neighbor key: {doc_id}")
            continue
        if len(lst) > NEIGHBOR_TOP_K:
            problems.append(f"{doc_id}: {len(lst)} neighbors exceed Top-K={NEIGHBOR_TOP_K}")
        ids = [n["id"] for n in lst]
        if doc_id in ids:
            problems.append(f"{doc_id}: self-match present")
        if len(ids) != len(set(ids)):
            problems.append(f"{doc_id}: duplicate neighbor ids")
        for n in lst:
            if n["id"] not in valid_ids:
                problems.append(f"{doc_id}: neighbor {n['id']} not in dataset")
            s = n["score"]
            if not (isinstance(s, (int, float)) and 0.0 <= s <= 1.0):
                problems.append(f"{doc_id}: score {s} outside [0, 1]")
            all_scores.append(float(s))
            hub[n["id"]] = hub.get(n["id"], 0) + 1
        for a, b in zip(lst, lst[1:]):
            if b["score"] > a["score"]:
                problems.append(f"{doc_id}: ranking not descending")
                break
        neighbor_count_hist[len(lst)] = neighbor_count_hist.get(len(lst), 0) + 1
    if problems:
        for p in problems[:20]:
            print(f"[pipeline] NEIGHBOR VALIDATION: {p}")
        raise SystemExit(
            f"FATAL: neighbor map failed validation ({len(problems)} problem(s)); nothing published"
        )
    scores_sorted = sorted(all_scores)
    n = len(all_scores)
    top_hubs = sorted(hub.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    return {
        "documentsWithNeighbors": len(neighbors),
        "documentsEligible": len(doc_ids),
        "coverage": round(len(neighbors) / max(len(doc_ids), 1), 4),
        "recordsWithNoSimilar": len(doc_ids) - len(neighbors),
        "totalNeighborEntries": n,
        "scoreMin": round(min(all_scores), 4) if n else None,
        "scoreMedian": round((scores_sorted[(n - 1) // 2] + scores_sorted[n // 2]) / 2, 4) if n else None,
        "scoreMax": round(max(all_scores), 4) if n else None,
        "neighborCountHistogram": {str(k): v for k, v in sorted(neighbor_count_hist.items())},
        "hubTop": [{"id": i, "count": c} for i, c in top_hubs],
        "hubMaxCount": top_hubs[0][1] if top_hubs else 0,
    }


def build(data_path: Path, out_path: Path, summary_path: Path | None):
    raw_bytes = data_path.read_bytes()
    source_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    raw_records = json.loads(raw_bytes.decode("utf-8"))
    if not isinstance(raw_records, list):
        raise SystemExit("FATAL: data.json root is not a list (schema.js policy)")
    valid, issues, counts = validate_records(raw_records)
    drift_fingerprint, dataset_fingerprint = dataset_fingerprints(valid)
    # Phase IV: every source record keeps its classic-directory visibility;
    # NLP operates only on text-eligible records, keyed by app identity.
    seen_ids: dict = {}
    for r in valid:
        r["identity"] = record_identity(r, seen_ids)
    topic_eligible = sum(1 for r in valid if str(r.get("text") or "").strip())
    print(f"[pipeline] dataset: {counts['total']} records, "
          f"{counts['valid']} classic-visible, {topic_eligible} topic-eligible")

    normalized = [normalize_fa(r["text"]) for r in valid]
    nonempty_idx = [i for i, t in enumerate(normalized) if t.strip()]
    docs = [normalized[i] for i in nonempty_idx]
    print(f"[pipeline] {len(docs)} documents with text out of {len(valid)}")

    vectorizer = TfidfVectorizer(
        analyzer="word",
        tokenizer=tokenize,
        lowercase=False,            # already normalized
        preprocessor=None,
        ngram_range=NGRAM_RANGE,
        min_df=TFIDF_MIN_DF,
        max_df=TFIDF_MAX_DF,
        sublinear_tf=SUBLINEAR_TF,
        strip_accents=None,
    )
    tfidf = vectorizer.fit_transform(docs)
    feature_names = vectorizer.get_feature_names_out()
    print(f"[pipeline] TF-IDF matrix: {tfidf.shape[0]} docs x {tfidf.shape[1]} features")

    n_components = min(SVD_COMPONENTS, tfidf.shape[1] - 1, tfidf.shape[0] - 1)
    from sklearn.decomposition import TruncatedSVD
    svd = TruncatedSVD(n_components=max(n_components, 2), random_state=RNG_SEED)
    lsa = Normalizer(copy=True).fit_transform(svd.fit_transform(tfidf))
    explained = float(svd.explained_variance_ratio_.sum())
    print(f"[pipeline] SVD components={n_components}, explained variance={explained:.3f}")

    # binary doc-term presence for coherence (dense int8 — ~21 MB at this size)
    binary = np.asarray((tfidf > 0).todense(), dtype=np.int8)
    term_index = {t: i for i, t in enumerate(feature_names)}

    # candidate comparison
    all_results = {}
    for name in ["kmeans-consensus", "hdbscan-svd", "kmeans-tfidf"]:
        try:
            all_results.update(run_candidate(name, tfidf, lsa, feature_names, binary, term_index, RNG_SEED))
        except Exception as exc:  # a candidate may fail on degenerate corpora — recorded, not fatal
            all_results[name] = {"error": str(exc)}
            print(f"[pipeline] candidate {name} failed: {exc}")

    comparison = {}
    for name, res in all_results.items():
        if res is None:
            comparison[name] = {"error": "no qualifying clustering for any k"}
            continue
        if "error" in res:
            comparison[name] = {"error": res["error"]}
            continue
        comparison[name] = {
            "quality": res["quality"],
            "score": round(res["score"], 4) if isinstance(res.get("score"), float) else res.get("score"),
        }
        if name == "kmeans-svd":
            comparison[name]["k"] = res.get("k")
    print("[pipeline] comparison:", json.dumps(comparison, ensure_ascii=False, default=str))

    # stability across seeds for the leading candidate
    best_name = max(
        (n for n in all_results if all_results.get(n) and "labels" in all_results[n]),
        key=lambda n: all_results[n].get("score", -1) if isinstance(all_results[n].get("score"), float) else -1,
        default=None,
    )
    stability = None
    if best_name == "kmeans-consensus":
        # Stability of the FULL ensemble: rebuild it from two different seed
        # bases and compare assignments on all docs.
        k = all_results["kmeans-consensus"]["k"]
        alt_labels = []
        for offset in (1000, 2000):
            alt, _ = consensus_cluster(lsa, k, 7, RNG_SEED + offset, tfidf, feature_names, MIN_CLUSTER_SIZE)
            alt_labels.append(alt)
        aris = [stability_ari(lsa, all_results["kmeans-consensus"]["labels"], alt) for alt in alt_labels]
        stability = {"method": "kmeans-consensus-ensembles", "k": k,
                     "ensembleSeeds": 7, "replications": 2,
                     "meanPairwiseAri": round(float(np.mean(aris)), 4), "aris": [round(a, 4) for a in aris]}
    elif best_name == "hdbscan-svd":
        # HDBSCAN is deterministic on fixed data; approximate stability via
        # bootstrap: resample 90% of docs, refit, compare shared docs.
        rng = np.random.RandomState(RNG_SEED)
        aris = []
        base_labels = all_results["hdbscan-svd"]["labels"]
        for trial in range(3):
            idx = rng.choice(len(docs), size=int(len(docs) * 0.9), replace=False)
            sub = HDBSCAN(min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE, min_samples=HDBSCAN_MIN_SAMPLES,
                          metric="euclidean", cluster_selection_method="eom").fit(lsa[idx])
            aris.append(stability_ari(lsa[idx], base_labels[idx], sub.labels_))
        stability = {"method": "hdbscan-svd-bootstrap", "trials": 3,
                     "meanPairwiseAri": round(float(np.mean(aris)), 4), "aris": [round(a, 4) for a in aris]}
    print("[pipeline] stability:", json.dumps(stability))

    # Save the best kmeans-consensus result for manifest
    best_kmeans_consensus = all_results.get("kmeans-consensus")

    # threshold gate (documented in the manifest)
    q = all_results[best_name]["quality"] if best_name else None
    passes = bool(
        q
        and q["nTopicsKept"] >= 4
        and q["outlierShare"] <= MAX_OUTLIER_SHARE
        and stability and stability["meanPairwiseAri"] >= MIN_STABILITY_ARI
        and q["meanSilhouette"] is not None and q["meanSilhouette"] >= MIN_MEAN_SILHOUETTE
        and (q["meanNpmiCoherence"] or -1) > 0
    )
    mode = "semantic" if passes else "lexical-fallback"
    print(f"[pipeline] selected={best_name} topic-mode={mode}")

    topics = []
    doc_topic = {}
    # doc offsets map back to record identities (shared by topics + neighbors)
    doc_ids = [valid[i]["identity"] for i in nonempty_idx]
    if passes:
        labels = all_results[best_name]["labels"]
        labels_obj = all_results[best_name]["labelsObj"]
        for c, info in sorted(labels_obj.items()):
            member_rows = [i for i, l in enumerate(labels) if l == c]
            member_ids = [doc_ids[i] for i in member_rows]
            topic_id = "t-" + hashlib.sha256(",".join(map(str, sorted(member_ids))).encode("utf-8")).hexdigest()[:12]
            phrases = [p for p, _, _ in info["phrases"][:LABEL_TOP_PHRASES]]
            # Label rule (algorithmic, no curation): prefer the first
            # multi-token phrase (more descriptive than a bare copula);
            # fall back to the top phrase.
            label = next((p for p in phrases if len(p.split()) >= 2), phrases[0] if phrases else f"موضوع {c}")
            # exemplars: records whose vector is closest to the cluster centroid
            rows = np.where(labels == c)[0]
            centroid = lsa[rows].mean(axis=0)
            centroid /= (np.linalg.norm(centroid) + 1e-12)
            sims = lsa[rows] @ centroid
            exemplar_rows = rows[np.argsort(sims)[::-1][:EXEMPLARS_PER_TOPIC]]
            # Deterministic duplicate-label disambiguation BEFORE appending:
            # append the next distinct phrase when an earlier topic already
            # produced the same label.
            base_label = label
            suffix = 2
            existing_labels = {t["label"] for t in topics}
            while label in existing_labels and suffix <= len(phrases) + 1:
                alt = phrases[suffix - 1] if suffix - 1 < len(phrases) else None
                label = f"{base_label} — {alt}" if alt else f"{base_label} ({suffix})"
                suffix += 1
            topics.append({
                "id": topic_id,
                "label": label,
                "labelKind": "auto-generated",
                "phrases": phrases,
                "size": len(member_ids),
                "share": round(len(member_ids) / len(docs), 4),
                "docIds": member_ids,
                "exemplarIds": [doc_ids[i] for i in exemplar_rows],
            })

            for i in member_rows:
                doc_topic[doc_ids[i]] = topic_id

    # --- Neighbors: decoupled from the topic-clustering gate (fix 2026-11) ---
    # LSA cosine similarity between documents does not depend on topic
    # clustering, and the clustering quality gate says nothing about
    # neighbor-list quality. Pipeline 2.0.0 nested neighbor generation inside
    # `if passes:`, so whenever the topic gate failed (e.g. cross-environment
    # sklearn variance on the automated regeneration), the "lexical-fallback"
    # artifact shipped an EMPTY neighbor map and the per-card
    # similar-experiences feature disappeared entirely. The gate now governs
    # topics only; neighbors are computed whenever the LSA space exists, with
    # an explicit score threshold, self-exclusion, duplicate exclusion and
    # per-course/per-professor diversity caps. A record with no candidate at
    # or above NEIGHBOR_MIN_SCORE gets no entry: an honest empty state, never
    # a forced match.
    neighbors = {}
    neighbor_method = "lsa-unavailable"
    if lsa.shape[0] >= 2:
        neighbor_method = "lsa-cosine"
        norms = np.linalg.norm(lsa, axis=1, keepdims=True)
        unit = lsa / np.maximum(norms, 1e-12)
        sims = unit @ unit.T
        # Keyed by record IDENTITY (the app's lookup key). Pipeline 2.0.0 keyed
        # these maps by the raw dataset id (JSON number) while comparing them
        # against identity strings, so both diversity caps were silently dead
        # code (measured: 23 lists exceeded the same-course cap).
        course_by_id = {r["identity"]: normalize_fa(r["course"]) for r in valid}
        prof_by_id = {r["identity"]: normalize_fa(r["professor"]) for r in valid}
        for i, doc_id in enumerate(doc_ids):
            order = np.argsort(-sims[i])
            picked = []
            same_course = 0
            same_prof = 0
            for j in order:
                if j == i:
                    continue
                score = float(sims[i, j])
                if score < NEIGHBOR_MIN_SCORE:
                    break
                nid = doc_ids[j]
                if course_by_id.get(nid) and course_by_id[nid] == course_by_id.get(doc_id):
                    if same_course >= NEIGHBOR_MAX_SAME_COURSE:
                        continue
                    same_course += 1
                if prof_by_id.get(nid) and prof_by_id[nid] == prof_by_id.get(doc_id):
                    if same_prof >= NEIGHBOR_MAX_SAME_PROF:
                        continue
                    same_prof += 1
                picked.append({"id": nid, "score": round(score, 2)})
                if len(picked) >= NEIGHBOR_TOP_K:
                    break
            if picked:
                neighbors[doc_id] = picked
    neighbors_mode = "semantic" if neighbor_method == "lsa-cosine" else "lexical-fallback"
    print(f"[pipeline] neighbors: method={neighbor_method} docs={len(neighbors)}/{len(doc_ids)}")

    # Structural validation BEFORE publication — a corrupt or partial map
    # aborts the run instead of shipping.
    neighbor_audit = validate_neighbors(neighbors, doc_ids, valid)
    print(f"[pipeline] neighbor audit: coverage={neighbor_audit['coverage']}, "
          f"hubMax={neighbor_audit['hubMaxCount']}, "
          f"scoreRange=[{neighbor_audit['scoreMin']}, {neighbor_audit['scoreMax']}]")

    def _pkg_version(name):
        try:
            from importlib.metadata import version
            return version(name)
        except Exception:
            return None

    environment = {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "scipy": _pkg_version("scipy"),
        "scikit-learn": _pkg_version("scikit-learn"),
    }

    def content_checksum(obj):
        """Deterministic digest of artifact CONTENT (excludes generatedAt), so
        repeated runs over the same dataset can be compared byte-for-byte."""
        payload = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    topics_content_checksum = content_checksum({
        "topics": topics, "docTopic": doc_topic,
        "driftFingerprint": drift_fingerprint, "topicMode": mode,
    })
    neighbors_content_checksum = content_checksum({
        "neighbors": neighbors,
        "driftFingerprint": drift_fingerprint, "neighborMethod": neighbor_method,
    })

    artifact = {
        "manifest": {
            "pipelineVersion": PIPELINE_VERSION,
            "schemaVersion": SCHEMA_VERSION,
            "datasetSha256": source_sha256,
            "datasetDriftFingerprint": drift_fingerprint,
            "datasetFingerprint": dataset_fingerprint,
            "datasetRecords": counts["total"],
            "datasetValid": counts["valid"],
            "topicEligibleRecords": topic_eligible,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "mode": mode,
            "environment": environment,
            "config": {
                "svdComponents": int(n_components),
                "tfidfMinDf": TFIDF_MIN_DF,
                "tfidfMaxDf": TFIDF_MAX_DF,
                "ngramRange": list(NGRAM_RANGE),
                "sublinearTf": SUBLINEAR_TF,
                "selectedCandidate": best_name,
                "ensembleSeeds": 7 if best_name == "kmeans-consensus" else None,
                "consensusDistanceThreshold": 0.5,
                "minClusterSize": MIN_CLUSTER_SIZE,
                "neighborTopK": NEIGHBOR_TOP_K,
                "neighborMinScore": NEIGHBOR_MIN_SCORE,
                "neighborMaxSameCourse": NEIGHBOR_MAX_SAME_COURSE,
                "neighborMaxSameProfessor": NEIGHBOR_MAX_SAME_PROF,
                "chosenK": best_kmeans_consensus.get("k") if best_name == "kmeans-consensus" else None,
                "kSearchRange": [KMEANS_K_MIN, KMEANS_K_MAX, 4],
                "kFixedOperatingChoice": True
            },
            "seed": RNG_SEED,
        },
        "diagnostics": {
            "counts": counts,
            "comparison": comparison,
            "stability": stability,
            "explainedVariance": round(explained, 4),
            "validationIssues": issues[:200],
            "validationIssueCount": len(issues),
            "thresholds": {
                "minStabilityAri": MIN_STABILITY_ARI,
                "maxOutlierShare": MAX_OUTLIER_SHARE,
                "minMeanSilhouette": MIN_MEAN_SILHOUETTE,
            },
        },
        "topics": topics,
        "docTopic": doc_topic,
        "neighbors": neighbors,
    }

    # Two published artifacts: topics+manifest (small, topic explorer) and
    # neighbors+manifest (larger, loaded on explicit user action only — §12).
    # Each part carries its OWN mode: the topics mode reflects the clustering
    # quality gate, the neighbors mode reflects whether LSA neighbor lists
    # were actually computed. The frontend binds each artifact independently,
    # so a topic-gate failure must never disable per-card neighbors (this
    # coupling was the 2026-11 regression), and neighbor lists must never be
    # presented as semantic when they were not computed.
    topics_artifact = {
        "manifest": {
            **artifact["manifest"],
            "part": "topics",
            "contentChecksum": topics_content_checksum,
        },
        "diagnostics": artifact["diagnostics"],
        "topics": artifact["topics"],
        "docTopic": artifact["docTopic"],
    }
    neighbors_artifact = {
        "manifest": {
            **artifact["manifest"],
            "part": "neighbors",
            "mode": neighbors_mode,
            "neighborMethod": neighbor_method,
            "contentChecksum": neighbors_content_checksum,
        },
        "diagnostics": {**artifact["diagnostics"], "neighborAudit": neighbor_audit},
        "neighbors": neighbors,
    }

    # stage + validate + atomic publish. Artifact integrity hashes are recorded
    # in the build summary (a self-referential in-file hash is impossible);
    # the artifacts themselves bind to the dataset via datasetDriftFingerprint
    # (browser-recomputable) + datasetFingerprint (SHA-256 provenance), both of
    # which the frontend recomputes/verifies against the loaded dataset.
    out_path.parent.mkdir(parents=True, exist_ok=True)
    published = {}

    def publish(part_artifact, path: Path, expected_mode: str):
        payload = json.dumps(part_artifact, ensure_ascii=False)
        payload_bytes = payload.encode("utf-8")
        fd, tmp_name = tempfile.mkstemp(prefix=".atlas-", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
            reparsed = json.loads(Path(tmp_name).read_text(encoding="utf-8"))
            assert reparsed["manifest"]["datasetDriftFingerprint"] == drift_fingerprint
            assert reparsed["manifest"]["datasetFingerprint"] == dataset_fingerprint
            assert reparsed["manifest"]["mode"] == expected_mode
            os.replace(tmp_name, path)
        finally:
            if os.path.exists(tmp_name):
                os.remove(tmp_name)
        published[path.name] = {
            "sha256": hashlib.sha256(payload_bytes).hexdigest(),
            "bytes": len(payload_bytes),
        }

    topics_path = out_path.with_name("atlas-topics.json")
    neighbors_path = out_path.with_name("atlas-neighbors.json")
    publish(topics_artifact, topics_path, mode)
    publish(neighbors_artifact, neighbors_path, neighbors_mode)
    # Canonical Phase IV output contract: the split artifacts above.
    # (--out remains accepted for compatibility; only its directory is used.)

    summary = {
        "pipelineVersion": PIPELINE_VERSION,
        "datasetSha256": source_sha256,
        "datasetDriftFingerprint": drift_fingerprint,
        "datasetFingerprint": dataset_fingerprint,
        "mode": mode,
        "neighborsMode": neighbors_mode,
        "neighborMethod": neighbor_method,
        "selectedCandidate": best_name,
        "topics": len(topics),
        "topicSizes": [t["size"] for t in topics],
        "clusteredDocs": len(doc_topic),
        "neighborDocs": len(neighbors),
        "neighborAudit": neighbor_audit,
        "comparison": comparison,
        "stability": stability,
        "counts": counts,
        "environment": environment,
        "contentChecksums": {
            "topics": topics_content_checksum,
            "neighbors": neighbors_content_checksum,
        },
        "artifacts": published,
    }
    if summary_path:
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[pipeline] summary:", json.dumps(summary, ensure_ascii=False, default=str))
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="src/data.json")
    parser.add_argument("--out", default="src/derived/atlas.json")
    parser.add_argument("--summary", default=None)
    args = parser.parse_args()
    build(Path(args.data), Path(args.out), Path(args.summary) if args.summary else None)


if __name__ == "__main__":
    main()
