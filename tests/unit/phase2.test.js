import { describe, it, expect } from 'vitest';
import { normalizeWithMap, parseQueryTerms, toSearchable } from '../../src/lib/search.js';
import { validateDataset } from '../../src/lib/schema.js';
import { buildProfessorProfiles, buildProfiles, scoreStats, SCORE_BINS, indexByKey } from '../../src/lib/profiles.js';
import {
  buildTextIndex, buildKeywordFrequency,
  findNormSpans, buildHighlightExcerpt, searchFullText,
} from '../../src/lib/explorer.js';
import { parseRoute, professorRoute, courseRoute } from '../../src/lib/router.js';

// PHASE IV: records now flow through validateDataset (classic preservation +
// app-only identity) before toSearchable. Shared test helper.
function toSearchables(rawRecords) {
  return validateDataset(rawRecords).records.map(toSearchable);
}

describe('normalizeWithMap (highlight offset mapping)', () => {
  it('maps identity text 1:1', () => {
    const { norm, map } = normalizeWithMap('استاد خوبی بود');
    expect(norm).toBe('استاد خوبی بود');
    expect(map).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
  it('keeps offsets correct when ZWNJ is dropped', () => {
    const original = 'می\u200Cشود که';
    const { norm, map } = normalizeWithMap(original);
    expect(norm).toBe('میشود که');
    // 'که' starts at norm index 7 → original index 8 (ZWNJ occupied index 2)
    const span = [norm.indexOf('که'), norm.indexOf('که') + 2];
    expect(original.slice(map[span[0]], map[span[1] - 1] + 1)).toBe('که');
  });
  it('collapses whitespace runs and maps the first space only', () => {
    const original = 'a     b';
    const { norm, map } = normalizeWithMap(original);
    expect(norm).toBe('a b');
    expect(original.slice(map[1], map[1] + 1)).toBe(' ');
  });
  it('drops diacritics while keeping later offsets valid', () => {
    const original = 'مُحَمَّد خوب';
    const { norm, map } = normalizeWithMap(original);
    expect(norm).toBe('محمد خوب');
    const idx = norm.indexOf('خوب');
    expect(original.slice(map[idx], map[idx] + 3)).toBe('خوب');
  });
  it('handles empty and null', () => {
    expect(normalizeWithMap('').norm).toBe('');
    expect(normalizeWithMap(null).norm).toBe('');
    expect(normalizeWithMap('   ').norm).toBe('');
  });
});

describe('parseQueryTerms', () => {
  it('splits terms and quoted phrases', () => {
    const { terms, phrases } = parseQueryTerms('حضور "و غیاب" پروژه');
    expect(terms).toEqual(['حضور', 'پروژه']);
    expect(phrases).toEqual(['و غیاب']);
  });
  it('handles empty and whitespace-only queries', () => {
    expect(parseQueryTerms('')).toEqual({ terms: [], phrases: [] });
    expect(parseQueryTerms('   ')).toEqual({ terms: [], phrases: [] });
  });
  it('normalizes each part (Arabic forms)', () => {
    const { terms } = parseQueryTerms('كامپيوتر');
    expect(terms).toEqual(['کامپیوتر']);
  });
});

describe('scoreStats (0–20 descriptive statistics)', () => {
  it('computes avg/median/min/max/distribution', () => {
    const s = scoreStats([10, 18, 20, 13.5, 2]);
    expect(s.validCount).toBe(5);
    expect(s.avg).toBeCloseTo(12.7, 5);
    expect(s.median).toBe(13.5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(20);
    expect(s.distribution.reduce((a, b) => a + b, 0)).toBe(5);
    expect(s.distribution[0]).toBe(1); // 2 → 0–4
    expect(s.distribution[2]).toBe(1); // 10 → 9–12
    expect(s.distribution[3]).toBe(1); // 13.5 → 13–16
    expect(s.distribution[4]).toBe(2); // 18, 20 → 17–20
  });
  it('returns nulls for empty input (no zero-fabrication)', () => {
    const s = scoreStats([]);
    expect(s.validCount).toBe(0);
    expect(s.avg).toBeNull();
    expect(s.median).toBeNull();
  });
  it('has exactly 5 bins covering 0–20 without gaps', () => {
    let covered = 0;
    for (const bin of SCORE_BINS) covered += bin.max - bin.min + 1;
    expect(covered).toBe(21);
    expect(SCORE_BINS[0].min).toBe(0);
    expect(SCORE_BINS[SCORE_BINS.length - 1].max).toBe(20);
  });
});

function makeRecords() {
  return toSearchables([
    { id: 1, professor: 'علی رضایی', course: 'ریاضی', text: 'خوب بود', Link: 'https://t.me/x/1', Professor_Score: '10', Student_Score: '15' },
    { id: 2, professor: 'علی رضایی', course: 'فیزیک', text: 'امتحان سخت', Link: 'https://t.me/x/2', Professor_Score: '۱۸', Student_Score: '?' },
    { id: 3, professor: 'مريم محمدی', course: 'ریاضی', text: 'جزوه کامل', Link: 'https://t.me/x/3', Professor_Score: '?', Student_Score: '12' },
    { id: 4, professor: 'مریم محمدی', course: 'شیمی', text: 'حضور غیاب', Link: 'https://t.me/x/4', Professor_Score: '14', Student_Score: '10' },
  ]);
}

describe('profile grouping (deterministic identity rules)', () => {
  it('merges orthographic variants of the same name and picks the most frequent raw spelling', () => {
    const profs = buildProfessorProfiles(makeRecords());
    const mohammadi = profs.find((p) => p.key === 'مریم محمدی');
    expect(mohammadi).toBeDefined();
    expect(mohammadi.records.map((r) => r.id).sort()).toEqual([3, 4]);
    expect(mohammadi.name).toBe('مریم محمدی'); // Persian spelling more frequent than مريم
    expect(mohammadi.rawVariants.length).toBe(2);
  });
  it('computes per-professor stats with unknown handling', () => {
    const profs = buildProfessorProfiles(makeRecords());
    const rezaei = profs.find((p) => p.key === 'علی رضایی');
    expect(rezaei.totalCount).toBe(2);
    expect(rezaei.professorStats.validCount).toBe(2);
    expect(rezaei.professorStats.avg).toBe(14); // (10+18)/2
    const mohammadi = profs.find((p) => p.key === 'مریم محمدی');
    expect(mohammadi.professorStats.validCount).toBe(1); // '?' is unknown, not zero
    expect(mohammadi.professorStats.avg).toBe(14);
    expect(mohammadi.totalCount).toBe(2); // records are not dropped
  });
  it('lists distinct courses per professor and professors per course (canonical cross-references)', () => {
    const { professors, courses } = buildProfiles(makeRecords());
    const rezaei = professors.find((p) => p.key === 'علی رضایی');
    // equal counts → Persian collation (ر sorts before ف)
    expect(rezaei.courses.map((c) => c.name)).toEqual(['ریاضی', 'فیزیک']);
    const riazi = courses.find((c) => c.key === 'ریاضی');
    // the محمدی professor appears under her canonical Persian spelling even
    // though the ریاضی record itself used the Arabic-keyboard spelling
    expect(riazi.professors.map((p) => p.name)).toEqual(['علی رضایی', 'مریم محمدی']);
    expect(riazi.totalCount).toBe(2);
  });
  it('indexes profiles by key for deep links', () => {
    const profs = buildProfessorProfiles(makeRecords());
    const idx = indexByKey(profs);
    expect(idx.get('علی رضایی').name).toBe('علی رضایی');
  });
});

// PHASE III CHANGE REASON: the Phase II manually curated TOPICS taxonomy was
// removed by the Phase III mission (§3/§7 — a manual topic list that limits
// which themes can exist is not acceptable). Topic discovery is now
// corpus-derived at build time (tools/nlp_pipeline.py → atlas artifacts).
// The three tests below exercised the removed feature and are replaced by
// tests/unit/phase3.test.js (atlas binding) and the Phase III matrix harness.

describe('text index (Phase III: no manual taxonomy in the index)', () => {
  const data = makeRecords();
  const index = buildTextIndex(data);

  it('indexes normalized text without any topic classification', () => {
    expect(index.every((e) => e.textNorm !== undefined && e.topics === undefined)).toBe(true);
  });
});

describe('keyword frequency', () => {
  it('excludes stopwords and rare tokens, sorted by count', () => {
    const data = toSearchables([
      { id: 1, professor: 'الف', course: 'ب', text: 'جزوه جزوه جزوه امتحان امتحان کتاب', Link: '', Professor_Score: '?', Student_Score: '?' },
      { id: 2, professor: 'الف', course: 'ب', text: 'امتحان امتحان نادرکلمه', Link: '', Professor_Score: '?', Student_Score: '?' },
    ]);
    const idx = buildTextIndex(data);
    const kw = buildKeywordFrequency(idx, 10, 2);
    const tokens = kw.map((k) => k.token);
    expect(tokens).not.toContain('نادرکلمه'); // below threshold
    expect(tokens).toContain('امتحان');
    expect(tokens.indexOf('امتحان')).toBeLessThan(tokens.indexOf('جزوه'));
  });
});

describe('full-text search', () => {
  const data = makeRecords();
  const index = buildTextIndex(data);

  it('finds matches inside review text with match reasons', () => {
    const results = searchFullText(data, index, 'امتحان');
    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe(2);
    expect(results[0].matchedIn.text).toBe(true);
    expect(results[0].matchedIn.professor).toBe(false);
  });
  it('AND-combines multiple terms across fields', () => {
    // term1 in text, term2 in professor
    const results = searchFullText(data, index, 'جزوه محمدی');
    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe(3);
    expect(results[0].matchedIn.text).toBe(true);
    expect(results[0].matchedIn.professor).toBe(true);
  });
  it('returns nothing when one term has no match', () => {
    expect(searchFullText(data, index, 'جزوه ناهار').length).toBe(0);
  });
  it('handles empty/whitespace queries', () => {
    expect(searchFullText(data, index, '').length).toBe(0);
    expect(searchFullText(data, index, '   ').length).toBe(0);
  });
  it('normalization: Arabic Yeh query finds Persian Yeh text', () => {
    const withPersian = toSearchables([{ id: 5, professor: 'الف', course: 'ب', text: 'استاد یار خوبی بود', Link: '', Professor_Score: '?', Student_Score: '?' }]);
    const idx = buildTextIndex(withPersian);
    const arabicYeh = String.fromCharCode(0x064A);
    const results = searchFullText(withPersian, idx, 'یار'.replace('ی', arabicYeh));
    expect(results.length).toBe(1);
  });
});

describe('highlighting (original-text offsets stay accurate)', () => {
  it('highlights the exact original span across a ZWNJ boundary', () => {
    const original = 'امتحانش سخت بود ولی می\u200Cشود خواند';
    const { norm } = normalizeWithMap(original);
    const excerpt = buildHighlightExcerpt(original, norm, ['میشود'], 10);
    expect(excerpt).not.toBeNull();
    const matched = excerpt.segments.filter((s) => s.match).map((s) => s.text).join('');
    expect(matched).toBe('می\u200Cشود'); // original spelling preserved inside <mark>
  });
  it('clips long text around the first match with context', () => {
    const original = 'x'.repeat(200) + ' امتحان ' + 'y'.repeat(200);
    const { norm } = normalizeWithMap(original);
    const excerpt = buildHighlightExcerpt(original, norm, ['امتحان'], 20);
    expect(excerpt.clippedStart).toBe(true);
    expect(excerpt.clippedEnd).toBe(true);
    const plain = excerpt.segments.map((s) => s.text).join('');
    expect(plain).toContain('امتحان');
    expect(plain.length).toBeLessThan(original.length);
  });
  it('returns null when terms only matched the name fields', () => {
    const { norm } = normalizeWithMap('متن بی ربط');
    expect(buildHighlightExcerpt('متن بی ربط', norm, ['علی'])).toBeNull();
  });
  it('findNormSpans finds repeated occurrences', () => {
    const spans = findNormSpans('امتحان اول و امتحان دوم', 'امتحان');
    expect(spans).toEqual([[0, 6], [13, 19]]);
  });
});

describe('router', () => {
  it('parses all route shapes', () => {
    expect(parseRoute('').name).toBe('browse');
    expect(parseRoute('#/').name).toBe('browse');
    expect(parseRoute('#/professors').name).toBe('professors');
    expect(parseRoute(`#/professor/${encodeURIComponent('علی رضایی')}`)).toEqual({ name: 'professor', key: 'علی رضایی' });
    expect(parseRoute('#/courses').name).toBe('courses');
    expect(parseRoute('#/explore').name).toBe('explore');
    // Phase IV: experience identity may be numeric or synthetic (string);
    // any non-empty segment is a valid identity reference
    expect(parseRoute('#/experience/746')).toEqual({ name: 'experience', id: '746' });
    expect(parseRoute('#/experience/abc')).toEqual({ name: 'experience', id: 'abc' });
    expect(parseRoute(`#/experience/${encodeURIComponent('x-ab12cd34-o0')}`)).toEqual({ name: 'experience', id: 'x-ab12cd34-o0' });
    expect(parseRoute('#/experience/').name).toBe('browse');
    expect(parseRoute('#/nonsense/1').name).toBe('browse');
  });
  it('round-trips professor/course routes through encoding', () => {
    const key = 'سعید حسن حسینی';
    expect(parseRoute(professorRoute(key)).key).toBe(key);
    expect(parseRoute(courseRoute(key)).key).toBe(key);
  });
});
