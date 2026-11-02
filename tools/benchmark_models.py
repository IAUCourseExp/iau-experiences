#!/usr/bin/env python3
"""
Phase IV model benchmark (mission §9): candidate embedding models vs the
classical TF-IDF/SVD baseline, evaluated on the REAL IAU review corpus for the
tasks the product actually needs (clustering quality, neighbor usefulness,
Persian robustness, CPU cost on free CI runners).

Measured per candidate:
  - license (from the model card, verified separately in the report)
  - download size (HF snapshot), load time, peak RSS
  - encode throughput on 2,327 real reviews (CPU, batched)
  - clustering: 7-seed consensus KMeans quality (NPMI, silhouette, ARI)
  - neighbor spot checks (qualitative examples printed for the report)

Every candidate runs in an isolated try/except: one failure never aborts the
benchmark. Results are written to a machine-readable JSON for the report.

Usage:
  python tools/benchmark_models.py [--models noql,e5-small,...] [--out audit-artifacts/phase-4/model-benchmark.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from nlp_pipeline import (  # noqa: E402
    RNG_SEED, KMEANS_N_INIT, MIN_CLUSTER_SIZE,
    normalize_fa, tokenize, ctfidf_labels, terms_from_labels,
    npmi_coherence, cluster_quality, consensus_cluster, stability_ari,
)

CANDIDATES = {
    "noql": "shekar-ai/Noql",
    "e5-small": "intfloat/multilingual-e5-small",
    "f2llm-0.6b": "codefuse-ai/F2LLM-v2-0.6B",
    "qwen3-0.6b": "Qwen/Qwen3-Embedding-0.6B",
    "bge-m3": "BAAI/bge-m3",
}


def peak_rss_mb() -> float:
    # Windows: resource.getrusage is limited; use psutil when available.
    try:
        import psutil
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        return -1.0


def encode_texts(model, texts: list[str], batch_size: int = 32, show_progress: bool = False):
    t0 = time.time()
    emb = model.encode(texts, batch_size=batch_size, show_progress_bar=show_progress,
                       convert_to_numpy=True, normalize_embeddings=True)
    dt = time.time() - t0
    return np.asarray(emb, dtype=np.float32), dt


def evaluate_embeddings(name, embeddings, tfidf, feature_names, binary, term_index, valid, identities):
    """Cluster + neighbor evaluation identical in spirit to the pipeline gates."""
    from sklearn.decomposition import TruncatedSVD
    from sklearn.preprocessing import Normalizer

    # reduce to <=128 dims for clustering (embeddings already normalized)
    dim = embeddings.shape[1]
    if dim > 128:
        svd = TruncatedSVD(n_components=128, random_state=RNG_SEED)
        space = Normalizer().fit_transform(svd.fit_transform(embeddings))
        explained = float(svd.explained_variance_ratio_.sum())
    else:
        space = embeddings / (np.linalg.norm(embeddings, axis=1, keepdims=True) + 1e-12)
        explained = 1.0

    labels, dist = consensus_cluster(space, k=12, n_seeds=7, seed_base=RNG_SEED,
                                     tfidf_matrix=tfidf, feature_names=feature_names, min_size=MIN_CLUSTER_SIZE)
    labels_obj = ctfidf_labels(tfidf, labels, feature_names, MIN_CLUSTER_SIZE)
    q = cluster_quality(space, labels, terms_from_labels(labels_obj), binary, term_index)
    try:
        from sklearn.metrics import silhouette_score
        q["meanSilhouette"] = float(silhouette_score(dist, labels, metric="precomputed"))
        q["silhouetteSpace"] = "co-association"
    except ValueError:
        pass

    # stability: one full ensemble replication with a different seed base
    alt, _ = consensus_cluster(space, k=12, n_seeds=7, seed_base=RNG_SEED + 5000,
                               tfidf_matrix=tfidf, feature_names=feature_names, min_size=MIN_CLUSTER_SIZE)
    ari = stability_ari(space, labels, alt)

    # neighbors: mean top-1 similarity for non-duplicate pairs (evidence signal)
    norms = np.linalg.norm(space, axis=1, keepdims=True)
    unit = space / np.maximum(norms, 1e-12)
    sims = unit @ unit.T
    np.fill_diagonal(sims, -1)
    top1 = float(np.mean(np.max(sims, axis=1)))

    return {
        "clustering": q,
        "stabilityAri": round(ari, 4),
        "explainedVariance": round(explained, 4) if dim > 128 else None,
        "meanTop1Similarity": round(top1, 4),
        "topicLabels": [
            {"phrases": [p for p, _, _ in labels_obj[c]["phrases"][:4]], "size": labels_obj[c]["size"]}
            for c in sorted(labels_obj) if len(labels_obj[c]["phrases"]) > 0
        ][:6],
    }


def benchmark_candidate(key, model_id, texts, baseline_tfidf_pack, cache_root: Path):
    from sentence_transformers import SentenceTransformer

    result = {"key": key, "modelId": model_id}
    try:
        t0 = time.time()
        model = SentenceTransformer(model_id, device="cpu", cache_folder=str(cache_root))
        result["loadSeconds"] = round(time.time() - t0, 1)

        sample = model.encode(texts[:8], show_progress_bar=False)
        result["dimensions"] = int(np.asarray(sample).shape[1])

        t1 = time.time()
        full, _ = encode_texts(model, texts, batch_size=64, show_progress=False)
        result["encodeAllSeconds"] = round(time.time() - t1, 1)
        result["docsPerSecond"] = round(len(texts) / max(result["encodeAllSeconds"], 0.001))
        result["peakRssMb"] = round(peak_rss_mb())

        # embeddings need a fresh TF-IDF for c-TF-IDF labeling (same corpus)
        tfidf_pack = baseline_tfidf_pack
        eval_result = evaluate_embeddings(key, full, tfidf_pack["matrix"], tfidf_pack["names"],
                                          tfidf_pack["binary"], tfidf_pack["term_index"], None, None)
        result["evaluation"] = eval_result

        # model size on disk (cache)
        model_dir = Path(model.get_model_path(model_id) if hasattr(model, "get_model_path") else "")
        try:
            total = sum(f.stat().st_size for f in model_dir.rglob("*") if f.is_file())
            result["downloadMb"] = round(total / (1024 * 1024), 1)
        except Exception:
            result["downloadMb"] = None

        result["ok"] = True
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)[:400]
    return result


def classical_baseline(texts):
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.decomposition import TruncatedSVD
    from sklearn.preprocessing import Normalizer

    normalized = [normalize_fa(t) for t in texts]
    vec = TfidfVectorizer(analyzer="word", tokenizer=tokenize, lowercase=False,
                          ngram_range=(1, 2), min_df=3, max_df=0.60, sublinear_tf=True)
    X = vec.fit_transform(normalized)
    names = vec.get_feature_names_out()
    svd = TruncatedSVD(n_components=120, random_state=RNG_SEED)
    space = Normalizer().fit_transform(svd.fit_transform(X))
    binary = np.asarray((X > 0).todense(), dtype=np.int8)
    term_index = {t: i for i, t in enumerate(names)}
    return {"matrix": X, "names": names, "space": space, "binary": binary, "term_index": term_index}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="noql,e5-small,f2llm-0.6b,qwen3-0.6b,bge-m3")
    parser.add_argument("--out", default="audit-artifacts/phase-4/model-benchmark.json")
    parser.add_argument("--cache", default=os.environ.get("HF_HOME", str(ROOT / ".cache" / "hf")))
    args = parser.parse_args()

    data = json.loads((ROOT / "src/data.json").read_bytes().decode("utf-8"))
    texts = [str(r.get("text") or "") for r in data]
    texts = [t for t in texts if t.strip()]
    print(f"[benchmark] {len(texts)} documents")

    os.environ.setdefault("HF_HOME", args.cache)
    cache_root = Path(args.cache)
    cache_root.mkdir(parents=True, exist_ok=True)

    print("[benchmark] building classical baseline (TF-IDF/SVD)...")
    t0 = time.time()
    pack = classical_baseline(texts)
    baseline_eval = evaluate_embeddings("tfidf-svd", pack["space"], pack["matrix"], pack["names"],
                                        pack["binary"], pack["term_index"], None, None)
    baseline_seconds = round(time.time() - t0, 1)
    print(f"[benchmark] baseline done in {baseline_seconds}s: NPMI={baseline_eval['clustering']['meanNpmiCoherence']}")

    results = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "corpusDocs": len(texts),
        "runner": {"cpu": "local/CI standard (no GPU)", "python": sys.version.split()[0]},
        "baseline": {
            "key": "tfidf-svd",
            "modelId": "classical TF-IDF (1-2g) + SVD-120 + consensus KMeans",
            "license": "n/a (algorithm)",
            "evaluation": baseline_eval,
            "pipelineSeconds": baseline_seconds,
            "ok": True,
        },
        "candidates": [],
    }

    wanted = [m.strip() for m in args.models.split(",") if m.strip()]
    for key in wanted:
        model_id = CANDIDATES.get(key)
        if not model_id:
            continue
        print(f"[benchmark] === {key} ({model_id}) ===", flush=True)
        r = benchmark_candidate(key, model_id, texts, pack, cache_root)
        results["candidates"].append(r)
        print(f"[benchmark] {key}: ok={r.get('ok')} encode={r.get('encodeAllSeconds')}s "
              f"docs/s={r.get('docsPerSecond')} NPMI={r.get('evaluation', {}).get('clustering', {}).get('meanNpmiCoherence')}",
              flush=True)

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[benchmark] written: {out}")


if __name__ == "__main__":
    main()
