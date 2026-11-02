import { normalizePersian, normalizeWithMap, parseQueryTerms } from './search.js';

/**
 * Experience Intelligence Explorer (Feature 2) — pure logic.
 *
 * Transparency principles (mission §4.8):
 *  - Every result records WHERE it matched (text / professor / course).
 *  - Topic classification is keyword-family matching with the keyword lists
 *    shipped in the UI; it is presented as keyword discovery, not verdicts.
 *  - Nothing is invented: no sentiment, no summaries, no trends.
 */

/**
 * Phase III NOTE: the Phase II manually curated TOPICS list was removed —
 * topic discovery is now corpus-derived at build time (tools/nlp_pipeline.py)
 * and consumed from src/derived/atlas-topics.json with a dataset-checksum
 * binding (src/lib/atlas.js). A fixed algorithm may stay fixed; a manually
 * maintained taxonomy that limits which themes can exist may not (mission §3).
 * STOPWORDS below remains as a Persian language resource for the keyword
 * frequency chips only — it cannot add, remove, or rename any topic.
 */

/**
 * Persian stopwords for the keyword-discovery chips. Tokens appearing here are
 * function words / universal review filler with no discovery value.
 */
export const STOPWORDS = new Set([
  'و','در','به','از','که','این','را','با','است','برای','هم','می','شد','کرد','کند','بود','خود','های','همه','یک','دو','تا','بر','اگر','ولی','اما','یا','بعد','قبل','خیلی','شو','شده','داده','داشت','داره','دارن','بودم','هستم','بوده','میشه','کنه','کنم','کردم','کردن','میدن','میده','دادن','نمیده','بگیره','رو','تو','توی','چون','وقتی','الان','دیگه','بدون','شون','ایشون','ایشان','خانم','آقا','استاد','درس','ترم','پس','چیز','حتی','فقط','مثل','هستن','هست','نیست','هستم','اصلا','واقعا','اگه','باشه','بودن','باید','کلا','هیچ','بیشتر','دست','روی','باشید','کنید','بدید','میکنن','میکنه','میگن','بهتون','براشون','براش','خودشون','خوبه','مهم','مهمه','جواب','کامل','انجام','زیر','سر','چند','دوستان','دوست','دوستون','سلام','وقت','وقتها','دوره','واحد','جلسه','جلسات','کلاس','کلاسا','نمره','نمرات','نمرهش','استادش','شو','حالا','چطور','چقدر','هرچی','هر','چی','کی','کجا','بله','نه','خب','آره','اون','اونها','اینها','همین','همون','خواست','خواد','بخواد','دنبال','طبق','مورد','خیلیا','جور','جوری','هیج','بس','خوبی','بدی','زیاد','کمتر','بیشتریش','علی','سلام علیکم',
]);

/** Minimum corpus frequency for a token to appear as a discovery keyword. */
export const KEYWORD_MIN_COUNT = 40;

/**
 * Tokenize normalized text into candidate keywords.
 */
function tokenize(normText) {
  return normText.split(/[^\u0600-\u06FFa-z0-9]+/).filter((w) => w.length >= 3);
}

/**
 * Build the full-text index entries for the searchable records.
 * Only ONE additional normalized copy of the text is stored (mission §9.5);
 * highlight position maps are computed lazily per displayed result.
 *
 * @returns {Array<{ id, textNorm }>}
 */
export function buildTextIndex(searchable) {
  return searchable.map((item) => ({
    id: item.identity,
    textNorm: normalizePersian(item.text),
  }));
}

/**
 * Keyword frequency table across the corpus (for the discovery chips).
 * Stopwords and rare tokens are excluded.
 */
export function buildKeywordFrequency(textIndex, limit = 40, minCount = KEYWORD_MIN_COUNT) {
  const freq = new Map();
  for (const entry of textIndex) {
    for (const token of tokenize(entry.textNorm)) {
      if (STOPWORDS.has(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fa'))
    .slice(0, limit)
    .map(([token, count]) => ({ token, count }));
}

/**
 * Find the highlight spans of `needle` (already normalized) inside `textNorm`.
 * @returns {Array<[start, end]>} normalized-index spans (end exclusive)
 */
export function findNormSpans(textNorm, needle) {
  const spans = [];
  if (!needle) return spans;
  let from = 0;
  for (;;) {
    const idx = textNorm.indexOf(needle, from);
    if (idx === -1) break;
    spans.push([idx, idx + needle.length]);
    from = idx + Math.max(needle.length, 1);
    if (spans.length >= 20) break; // safety cap per term per record
  }
  return spans;
}

/**
 * Build the highlighted excerpt for one result.
 *
 * @param {string} originalText  display text (never modified)
 * @param {string} textNorm      normalized copy (from the index)
 * @param {string[]} highlightTerms  normalized terms/phrases to highlight
 * @param {number} contextChars  characters of context around the first match
 * @returns {{ segments: Array<{ text: string, match: boolean }>, clippedStart: boolean, clippedEnd: boolean } | null}
 *   null when none of the terms appear in the text (e.g. name-only matches).
 */
export function buildHighlightExcerpt(originalText, textNorm, highlightTerms, contextChars = 70) {
  const spans = [];
  for (const term of highlightTerms) {
    for (const [s, e] of findNormSpans(textNorm, term)) spans.push([s, e]);
  }
  if (spans.length === 0) return null;
  spans.sort((a, b) => a[0] - b[0]);

  // Merge overlapping spans
  const merged = [spans[0]];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const { map } = normalizeWithMap(originalText);
  // Map normalized span → original span (code-unit indices)
  const origSpans = merged
    .filter(([s, e]) => s < map.length && e - 1 < map.length)
    .map(([s, e]) => [map[s], map[e - 1] + 1]);

  if (origSpans.length === 0) return null;

  const firstStart = origSpans[0][0];
  const clippedStart = firstStart > contextChars;
  const windowStart = Math.max(0, firstStart - contextChars);
  const lastEnd = origSpans[origSpans.length - 1][1];
  const windowEnd = Math.min(originalText.length, lastEnd + contextChars);
  const clippedEnd = windowEnd < originalText.length;

  const segments = [];
  let cursor = windowStart;
  for (const [s, e] of origSpans) {
    if (s > cursor) segments.push({ text: originalText.slice(cursor, s), match: false });
    segments.push({ text: originalText.slice(s, e), match: true });
    cursor = Math.max(cursor, e);
  }
  if (cursor < windowEnd) segments.push({ text: originalText.slice(cursor, windowEnd), match: false });

  return { segments, clippedStart, clippedEnd };
}

/**
 * Full-text search across the searchable records + text index.
 *
 * Semantics (transparent and predictable):
 *  - Terms are AND-combined; each term must match in at least one of
 *    professor / course / text (substring, normalized).
 *  - Quoted phrases must appear verbatim-normalized inside the text.
 *  - Ranking: (1) number of distinct matched terms desc, (2) newest first.
 *
 * @returns {Array<{ item, matchedIn: {professor:boolean, course:boolean, text:boolean},
 *                    matchedTerms: string[], highlightTerms: string[] }>}
 */
export function searchFullText(searchable, textIndex, rawQuery) {
  const { terms, phrases } = parseQueryTerms(rawQuery);
  const needles = [...terms, ...phrases];
  if (needles.length === 0) return [];

    const indexById = new Map(textIndex.map((e) => [e.id, e])); // keys are record identities
  const results = [];

  for (const item of searchable) {
    const entry = indexById.get(item.identity);
    const matchedIn = { professor: false, course: false, text: false };
    const matchedTerms = [];
    const highlightTerms = [];
    let ok = true;

    for (const needle of needles) {
      const inProf = item._professorNorm.includes(needle);
      const inCourse = item._courseNorm.includes(needle);
      const inText = entry ? entry.textNorm.includes(needle) : false;
      if (!inProf && !inCourse && !inText) {
        ok = false;
        break;
      }
      if (inProf) matchedIn.professor = true;
      if (inCourse) matchedIn.course = true;
      if (inText) {
        matchedIn.text = true;
        highlightTerms.push(needle);
      }
      matchedTerms.push(needle);
    }
    if (!ok) continue;

    results.push({
      item,
      matchedIn,
      matchedTerms,
      highlightTerms,
      score: matchedTerms.length,
    });
  }

  results.sort((a, b) => b.score - a.score || b.item.id - a.item.id);
  return results;
}
