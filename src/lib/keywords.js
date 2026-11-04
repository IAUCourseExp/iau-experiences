import { normalizePersian } from './search.js';

/**
 * Decision-oriented keyword discovery (Phase V remediation of the old
 * unigram frequency chips).
 *
 * What changed and why: the previous section ranked single normalized tokens
 * by raw occurrence, which surfaced grammatical filler and isolated generic
 * words with little decision value. Students investigating a course or
 * professor ask questions like "is attendance mandatory?", "how hard are the
 * exams?", "how is grading handled?". Those questions live in MULTI-WORD
 * EXPRESSIONS in the corpus («حضور و غیاب», «خوش اخلاق»), not in bare
 * unigrams.
 *
 * Method (transparent, deterministic, corpus-derived only):
 *  1. Every record's text is normalized with the SAME normalizePersian used
 *     by search, so a chip's exact-phrase filter is guaranteed to match the
 *     records counted.
 *  2. Candidates = token windows of 1-3 adjacent tokens WITHIN a clause
 *     (clauses are split on sentence punctuation, so an expression never
 *     spans two sentences and cross-clause fragments cannot form), deduped
 *     WITHIN each record before counting. Counts are therefore
 *     DISTINCT-REPORT document frequency, never raw repetition inside one
 *     long review.
 *  3. A multi-word candidate must carry at least two "content" tokens
 *     (length >= 3, not a stopword) and may not START or END with a stopword
 *     (connectives like «و» are fine in the middle: «حضور و غیاب» stays,
 *     «خوش اخلاق و» cannot form).
 *  4. Ranking = document frequency; phrases before single terms; ties broken
 *     alphabetically. No opaque scores: a chip is shown because many distinct
 *     reports contain that exact expression, nothing else.
 *  5. Variant dedupe: two candidates with the SAME content-token signature
 *     («حضور غیاب» vs «حضور و غیاب») are one theme — the higher-df variant
 *     is kept and the other is counted as a variant duplicate.
 *  6. Redundancy pass: a single term is dropped when an already-selected
 *     phrase contains it as a part and covers at least REDUNDANCY_SHARE of
 *     the term's document frequency.
 *
 * Honesty rules: no topic labels or categories are invented, and counts are
 * reported as "distinct student reports mentioning this expression", which is
 * a fact about the corpus — not a verified claim about any professor.
 * tools/keyword-audit.mjs dumps the full candidate table with exclusions and
 * sample record ids for human review (audit-artifacts/keyword-audit/).
 */

/** Reuse the explorer stopword list: one language resource, one definition. */
export { STOPWORDS } from './explorer.js';
import { STOPWORDS } from './explorer.js';

/**
 * Generic evaluative adjectives: as standalone keywords they carry no
 * decision information (every review says something was good or excellent).
 * They remain fully visible inside extracted phrases, where they gain
 * specificity («تدریس خوب», «استاد خوب»).
 */
export const GENERIC_EVALUATIVE_TERMS = new Set(['خوب', 'عالی', 'عادی']);

/** Default: phrases need evidence from at least this many distinct reports. */
export const MIN_PHRASE_DF = 12;
/** Default: single terms need substantially more evidence than phrases. */
export const MIN_TERM_DF = 60;
/** A lone term is redundant when a selected phrase covers this df share. */
export const REDUNDANCY_SHARE = 0.8;

/** Clause separators: phrases never span these (prevents cross-sentence fragments). */
const CLAUSE_SPLIT_RE = /[.!؟?،؛;:,\n\r]+/;

/**
 * Tokenize normalized Persian text, keeping short connectives so that
 * expressions like «حضور و غیاب» are reconstructed exactly as they appear in
 * the normalized text (guaranteeing chip → search matches).
 */
export function tokenizeNorm(normText) {
  return normText.split(/[^@\u0600-\u06FFa-z0-9]+/).filter(Boolean);
}

function isContentToken(token) {
  return token.length >= 3 && !STOPWORDS.has(token) && !GENERIC_EVALUATIVE_TERMS.has(token);
}

/**
 * Candidate expressions for ONE record: unigrams (length >= 3) plus 2-3
 * token windows inside a single clause, with at least two content tokens and
 * no stopword at either edge. Returns a Set of phrase strings exactly as
 * they occur in the normalized text.
 */
export function recordPhrases(textNorm) {
  const phrases = new Set();
  for (const clause of textNorm.split(CLAUSE_SPLIT_RE)) {
    const tokens = tokenizeNorm(clause);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].length >= 3) phrases.add(tokens[i]);
      for (let span = 2; span <= 3 && i + span <= tokens.length; span++) {
        const window = tokens.slice(i, i + span);
        if (window.filter(isContentToken).length >= 2
          && !STOPWORDS.has(window[0])
          && !STOPWORDS.has(window[window.length - 1])) {
          phrases.add(window.join(' '));
        }
      }
    }
  }
  return phrases;
}

/** Content-token signature used to collapse phrase variants. */
function contentSignature(phrase) {
  return phrase.split(' ').filter(isContentToken).sort().join('+');
}

/**
 * Document-frequency pass over the whole index.
 * @param {Array<{id: string, textNorm: string}>} textIndex
 * @returns {Map<string, {df: number, sampleIds: string[]}>} phrase → stats
 */
export function phraseDocumentFrequency(textIndex) {
  const df = new Map();
  for (const entry of textIndex) {
    for (const phrase of recordPhrases(entry.textNorm)) {
      const stat = df.get(phrase);
      if (stat) {
        stat.df += 1;
        if (stat.sampleIds.length < 3) stat.sampleIds.push(entry.id);
      } else {
        df.set(phrase, { df: 1, sampleIds: [entry.id] });
      }
    }
  }
  return df;
}

/**
 * Full extraction: qualifying phrases + non-redundant single terms,
 * ranked and ready for the UI.
 *
 * @returns {{
 *   selected: Array<{ phrase: string, df: number, kind: 'phrase'|'term', sampleIds: string[] }>,
 *   excluded: { belowMinPhraseDf: number, belowMinTermDf: number, stopwordTerms: number,
 *               evaluativeTerms: number, variantDuplicates: number, redundantTerms: number },
 *   totalCandidates: number
 * }}
 */
export function buildKeywordInsights(textIndex, {
  phraseLimit = 12,
  termLimit = 8,
  minPhraseDf = MIN_PHRASE_DF,
  minTermDf = MIN_TERM_DF,
} = {}) {
  const dfMap = phraseDocumentFrequency(textIndex);

  const phrases = [];
  const terms = [];
  let stopwordTerms = 0;
  let evaluativeTerms = 0;

  for (const [phrase, stat] of dfMap) {
    if (phrase.includes(' ')) {
      if (stat.df >= minPhraseDf) phrases.push({ phrase, df: stat.df, kind: 'phrase', sampleIds: stat.sampleIds });
    } else if (STOPWORDS.has(phrase)) {
      stopwordTerms += 1;
    } else if (GENERIC_EVALUATIVE_TERMS.has(phrase)) {
      evaluativeTerms += 1;
    } else if (stat.df >= minTermDf) {
      terms.push({ phrase, df: stat.df, kind: 'term', sampleIds: stat.sampleIds });
    }
  }

  const totalPhraseCandidates = [...dfMap.keys()].filter((p) => p.includes(' ')).length;
  const totalTermCandidates = [...dfMap.keys()]
    .filter((p) => !p.includes(' ') && !STOPWORDS.has(p) && !GENERIC_EVALUATIVE_TERMS.has(p)).length;

  // Deterministic ranking: document frequency desc, then alphabetical (fa).
  const byDf = (a, b) => b.df - a.df || a.phrase.localeCompare(b.phrase, 'fa');
  phrases.sort(byDf);
  terms.sort(byDf);

  // Variant dedupe: keep the highest-df representative per content signature.
  const seenSignatures = new Set();
  const distinctPhrases = [];
  let variantDuplicates = 0;
  for (const p of phrases) {
    const sig = contentSignature(p.phrase);
    if (seenSignatures.has(sig)) {
      variantDuplicates += 1;
      continue;
    }
    seenSignatures.add(sig);
    distinctPhrases.push(p);
    if (distinctPhrases.length >= phraseLimit) break;
  }

  // Redundancy pass: drop a single term when an already-selected phrase
  // contains it as a part and carries at least REDUNDANCY_SHARE of its df.
  const keptTerms = [];
  let redundantTerms = 0;
  for (const term of terms) {
    const dominated = distinctPhrases.some((p) => (
      p.phrase.split(' ').includes(term.phrase) && p.df >= term.df * REDUNDANCY_SHARE
    ));
    if (dominated) {
      redundantTerms += 1;
      continue;
    }
    keptTerms.push(term);
    if (keptTerms.length >= termLimit) break;
  }

  const selected = [...distinctPhrases, ...keptTerms].sort(byDf);

  return {
    selected,
    excluded: {
      belowMinPhraseDf: totalPhraseCandidates - phrases.length,
      belowMinTermDf: totalTermCandidates - terms.length,
      stopwordTerms,
      evaluativeTerms,
      variantDuplicates,
      redundantTerms,
    },
    totalCandidates: dfMap.size,
  };
}

/**
 * Build the quoted exact-phrase query for a chip so the explorer's result
 * list and the chip's displayed count refer to the same evidence.
 */
export function chipQuery(phrase) {
  return `«${normalizePersian(phrase)}»`;
}
