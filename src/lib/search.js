/**
 * Pure search / scoring helpers for IAU Experiences.
 *
 * These functions never mutate the dataset; display text always stays the
 * original string. Normalization is applied to in-memory copies only.
 */

// Written with explicit Unicode escapes so visually-identical Persian/Arabic
// letters can never be confused in source code.
const ARABIC_TO_PERSIAN = {
  '\u064A': '\u06CC', // Arabic Yeh -> Persian Yeh
  '\u0649': '\u06CC', // Alef Maksura -> Persian Yeh
  '\u0643': '\u06A9', // Arabic Kaf -> Persian Kaf
  '\u0624': '\u0648', // Waw with Hamza -> Waw
  '\u0623': '\u0627', // Alef with Hamza Above -> Alef
  '\u0625': '\u0627', // Alef with Hamza Below -> Alef
  '\u0671': '\u0627', // Alef Wasla -> Alef
  '\u0629': '\u0647', // Teh Marbuta -> Heh
  '\u06C0': '\u0647', // Heh with Yeh Above -> Heh
};

const PERSIAN_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(0x06F0 + i)).join('');
const ARABIC_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(0x0660 + i)).join('');

/**
 * Convert Persian (۰-۹) and Arabic (٠-٩) digits to ASCII digits.
 * Leaves every other character untouched.
 */
export function toEnglishDigits(input) {
  if (input == null) return '';
  let out = '';
  const s = String(input);
  for (const ch of s) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p !== -1) { out += p; continue; }
    const a = ARABIC_DIGITS.indexOf(ch);
    if (a !== -1) { out += a; continue; }
    out += ch;
  }
  return out;
}

/**
 * Persian-aware text normalization used for *matching only*.
 * Handles: Arabic/Persian letter variants, Persian & Arabic digits,
 * diacritics/tatweel, zero-width characters (incl. ZWNJ), whitespace collapsing.
 */
export function normalizePersian(input) {
  if (input == null) return '';
  let s = String(input).toLowerCase();

  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[يكىؤأإٱةۀ]/g, (ch) => ARABIC_TO_PERSIAN[ch] || ch);

  // Diacritics (fathatan..sukun), superscript alef, tatweel
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
  // Zero-width chars & bidi controls (ZWNJ, ZWJ, LRM, RLM, ...)
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u00AD]/g, '');

  return s.replace(/\s+/g, ' ').trim();
}

const DROP_RE = /[\u064B-\u0652\u0670\u0640\u200B-\u200F\u202A-\u202E\u00AD]/;

/**
 * Normalize text while tracking each output character's position in the
 * ORIGINAL string. Used by the full-text explorer so that a match found in
 * the normalized text can be highlighted at the correct offset of the
 * original (displayed) text — even though normalization drops characters
 * (ZWNJ, diacritics), collapses whitespace and maps chars 1:1.
 *
 * @returns {{ norm: string, map: number[] }} map[normIndex] = original index
 */
export function normalizeWithMap(input) {
  const original = input == null ? '' : String(input);
  const out = [];
  const map = [];
  let lastWasSpace = true; // trims leading whitespace for free
  for (let i = 0; i < original.length; i++) {
    let ch = original[i];
    const lower = ch.toLowerCase();
    if (lower !== ch) ch = lower;
    if (DROP_RE.test(ch)) continue; // dropped by normalization
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u00A0') {
      if (lastWasSpace) continue; // collapse whitespace runs
      out.push(' ');
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p !== -1) ch = String(p);
    else {
      const a = ARABIC_DIGITS.indexOf(ch);
      if (a !== -1) ch = String(a);
      else ch = ARABIC_TO_PERSIAN[ch] || ch;
    }
    out.push(ch);
    map.push(i);
    lastWasSpace = false;
  }
  // trim trailing space
  while (out.length && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { norm: out.join(''), map };
}

/**
 * Split a raw query into terms (single words, AND-combined) and quoted
 * phrases. Returns normalized, non-empty entries.
 *   'حضور "و غیاب" پروژه' → { terms: ['حضور','پروژه'], phrases: ['و غیاب'] }
 * Persian guillemets are accepted as phrase quotes as well — the explorer's
 * help text and the keyword chips advertise «...», and the parser silently
 * ignored them until Phase V (the chips made that defect user-visible).
 *   '«حضور و غیاب»' → { terms: [], phrases: ['حضور و غیاب'] }
 */
export function parseQueryTerms(rawQuery) {
  const q = normalizePersian(rawQuery);
  if (!q) return { terms: [], phrases: [] };
  const phrases = [];
  const rest = q.replace(/[«"]([^»"]+)[»"]/g, (_, phrase) => {
    const p = normalizePersian(phrase);
    if (p) phrases.push(p);
    return ' ';
  });
  const terms = rest.split(' ').filter((t) => t.length > 0 && !phrases.includes(t));
  return { terms, phrases };
}

/**
 * Parse a score string into a plausible number on the 0–20 scale.
 * Returns null for unknown ("?"), non-numeric or out-of-scale values
 * (the dataset contains junk such as "۱۰۰۰۰۰۰۰۰" and "-1").
 */
export function parseScore(value) {
  if (value == null) return null;
  const cleaned = toEnglishDigits(String(value)).trim();
  if (!cleaned || cleaned === '?') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 20) return null;
  return n;
}

/**
 * Build a searchable view-model for one validated record (Phase IV:
 * identity-based — every classic record is searchable-modelled; eligibility
 * flags ride along). Never mutates the input; display fields are copied as-is.
 */
export function toSearchable(item) {
  const professor = item.professor == null ? '' : String(item.professor);
  const course = item.course == null ? '' : String(item.course);
  const numericId = typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : null;
  return {
    ...item,
    professor,
    course,
    text: item.text == null ? '' : String(item.text),
    Link: item.Link == null ? '' : String(item.Link),
    Professor_Score: item.Professor_Score == null ? '?' : String(item.Professor_Score),
    Student_Score: item.Student_Score == null ? '?' : String(item.Student_Score),
    identity: item.identity != null ? String(item.identity) : String(numericId ?? ''),
    numericId,
    _professorNorm: normalizePersian(professor),
    _courseNorm: normalizePersian(course),
    _professorScore: parseScore(item.Professor_Score),
    _studentScore: parseScore(item.Student_Score),
  };
}

function byIdDesc(a, b) {
  // numeric source id first; synthetic-identity records sort by recency
  // proxy: record number encoded in the identity ordering — use numericId
  // when present, otherwise keep stable order via identity string compare
  const na = a.numericId ?? 0;
  const nb = b.numericId ?? 0;
  if (na !== nb) return nb - na;
  return String(b.identity || '').localeCompare(String(a.identity || ''));
}

function byScoreDesc(a, b) {
  const sa = a._professorScore;
  const sb = b._professorScore;
  // Unknown scores always sort after known ones
  if (sa == null && sb == null) return byIdDesc(a, b);
  if (sa == null) return 1;
  if (sb == null) return -1;
  if (sb !== sa) return sb - sa;
  return byIdDesc(a, b);
}

/**
 * Filter + sort experiences.
 *
 * @param {Array} searchable  Precomputed via `toSearchable` (already newest-first base).
 * @param {string} rawQuery   Raw user input; normalized + trimmed internally.
 * @param {'newest'|'score'} sortMode  Explicit, user-visible ordering.
 * @returns {Array} filtered/sorted copies (no mutation of inputs).
 */
export function filterAndSort(searchable, rawQuery, sortMode) {
  const query = normalizePersian(rawQuery);
  if (!query) {
    return [...searchable].sort(sortMode === 'score' ? byScoreDesc : byIdDesc);
  }
  const matches = searchable.filter(
    (item) => item._professorNorm.includes(query) || item._courseNorm.includes(query)
  );
  // Within search results, relevance ordering follows the chosen sort mode.
  return matches.sort(sortMode === 'score' ? byScoreDesc : byIdDesc);
}
