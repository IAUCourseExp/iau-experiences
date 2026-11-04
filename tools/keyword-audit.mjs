#!/usr/bin/env node
/**
 * Keyword-discovery audit dump (Phase V requirement 4.5).
 *
 * Runs the EXACT extraction used by the browser (src/lib/keywords.js over the
 * full dataset) and writes a reviewable audit file:
 *   audit-artifacts/keyword-audit/keyword-audit.json
 *
 * The audit contains: extraction configuration, total candidate counts,
 * exclusion counts with reasons, every selected phrase/term with its
 * DISTINCT-REPORT document frequency and sample record ids, representative
 * source-text snippets, and the full table of qualifying candidates
 * (df >= thresholds) that did NOT make the displayed selection.
 *
 * Read-only over the dataset; writes only under audit-artifacts/ (gitignored).
 * Usage: node tools/keyword-audit.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePersian } from '../src/lib/search.js';
import {
  buildKeywordInsights,
  phraseDocumentFrequency,
  STOPWORDS,
  GENERIC_EVALUATIVE_TERMS,
  MIN_PHRASE_DF,
  MIN_TERM_DF,
  REDUNDANCY_SHARE,
} from '../src/lib/keywords.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data.json'), 'utf8'));
const textById = new Map(data.map((r) => [String(r.id), String(r.text || '')]));

const textIndex = data.map((r) => ({
  id: String(r.id),
  textNorm: normalizePersian(String(r.text || '')),
}));

const insights = buildKeywordInsights(textIndex);
const dfMap = phraseDocumentFrequency(textIndex);

function snippet(id, phrase) {
  const norm = textIndex.find((e) => e.id === id)?.textNorm || '';
  const idx = norm.indexOf(phrase);
  if (idx === -1) return null;
  const original = textById.get(id) || '';
  // Approximate the snippet in the ORIGINAL text by proportional position.
  const ratio = norm.length > 0 ? idx / norm.length : 0;
  const origIdx = Math.min(original.length - 1, Math.round(ratio * original.length));
  return original.slice(Math.max(0, origIdx - 70), origIdx + 90).replace(/\s+/g, ' ').trim();
}

const audit = {
  purpose: 'Audit of the explorer keyword-discovery extraction (decision-relevant recurring expressions). Counts are DISTINCT-REPORT document frequency: in how many separate student reports the exact expression appears. This is corpus evidence, not a verified claim about any professor.',
  generatedAt: new Date().toISOString(),
  dataset: { records: data.length, sha256Source: 'src/data.json (see release preflight marker for its hash)' },
  configuration: {
    minPhraseDf: MIN_PHRASE_DF,
    minTermDf: MIN_TERM_DF,
    redundancyShare: REDUNDANCY_SHARE,
    stopwordListSize: STOPWORDS.size,
    genericEvaluativeTerms: [...GENERIC_EVALUATIVE_TERMS],
    method: '1-3 token windows inside a clause of normalizePersian(text); per-record dedup; df = distinct records; phrases ranked by df then alphabetical; variant phrases with identical content-token signatures collapsed; lone terms dropped when a selected phrase contains them with >= 80% of their df.',
  },
  totals: {
    totalCandidates: insights.totalCandidates,
    displayed: insights.selected.length,
    excluded: insights.excluded,
  },
  selected: insights.selected.map((k) => ({
    phrase: k.phrase,
    kind: k.kind,
    distinctReportCount: k.df,
    sampleRecordIds: k.sampleIds,
    sampleSnippets: k.sampleIds
      .map((id) => ({ id, text: snippet(id, k.phrase) }))
      .filter((s) => s.text),
  })),
  knownLimitations: [
    'Persian morphological variants are NOT stemmed: «خوش اخلاق» and «خوش اخلاقی» appear as separate expressions (same theme, different tokens).',
    'Colloquial verb fragments that pass the clause/stopword filters may survive, e.g. «راه میاد» (from «راه نمیده»). They are real recurring corpus expressions but read as fragments.',
    'Document frequency counts records containing the expression anywhere — it does not weight negation («حضور ضروری نیست» counts as a حضور-related report).',
    'The snippet positions are approximate (proportional mapping from normalized to original text).',
  ],
};

// Full qualifying-candidate table (beyond the displayed selection).
audit.qualifyingCandidates = [...dfMap.entries()]
  .map(([phrase, stat]) => ({ phrase, df: stat.df, sampleIds: stat.sampleIds }))
  .filter((c) => (c.phrase.includes(' ') ? c.df >= MIN_PHRASE_DF : c.df >= MIN_TERM_DF))
  .sort((a, b) => b.df - a.df || a.phrase.localeCompare(b.phrase, 'fa'));

const outDir = path.join(ROOT, 'audit-artifacts', 'keyword-audit');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'keyword-audit.json');
fs.writeFileSync(outPath, JSON.stringify(audit, null, 1), 'utf8');

console.log(`[keyword-audit] candidates=${insights.totalCandidates} displayed=${insights.selected.length}`);
console.log(`[keyword-audit] excluded=${JSON.stringify(insights.excluded)}`);
console.log(`[keyword-audit] written: ${outPath}`);
