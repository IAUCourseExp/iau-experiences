import { describe, it, expect } from 'vitest';
import {
  toEnglishDigits,
  normalizePersian,
  parseScore,
  toSearchable,
  filterAndSort,
} from '../../src/lib/search.js';

describe('toEnglishDigits', () => {
  it('converts Persian digits', () => {
    expect(toEnglishDigits('۱۷.۵')).toBe('17.5');
  });
  it('converts Arabic digits', () => {
    expect(toEnglishDigits('١٠')).toBe('10');
  });
  it('converts mixed content and leaves Latin untouched', () => {
    expect(toEnglishDigits('درس ۲ و 3')).toBe('درس 2 و 3');
  });
  it('handles null/undefined/empty', () => {
    expect(toEnglishDigits(null)).toBe('');
    expect(toEnglishDigits(undefined)).toBe('');
    expect(toEnglishDigits('')).toBe('');
  });
});

describe('normalizePersian (search matching only — display text untouched)', () => {
  it('matches Arabic Yeh against Persian Yeh in both directions', () => {
    expect(normalizePersian('محمدی')).toBe(normalizePersian('محمدي'));
  });
  it('matches Arabic Kaf against Persian Kaf', () => {
    expect(normalizePersian('کامپیوتر')).toBe(normalizePersian('كامپیوتر'));
  });
  it('ignores ZWNJ (U+200C) differences', () => {
    expect(normalizePersian('می\u200Cشود')).toBe(normalizePersian('میشود'));
  });
  it('unifies Persian and Arabic digits', () => {
    expect(normalizePersian('درس۲')).toBe(normalizePersian('درس2'));
    expect(normalizePersian('درس١')).toBe(normalizePersian('درس1'));
  });
  it('strips diacritics and tatweel', () => {
    expect(normalizePersian('مُحَمَّـد')).toBe(normalizePersian('محمد'));
  });
  it('collapses whitespace and trims', () => {
    expect(normalizePersian('  علی   رضا ')).toBe('علی رضا');
  });
  it('is case-insensitive for Latin content', () => {
    expect(normalizePersian('Java')).toBe(normalizePersian('java'));
  });
  it('handles null/undefined safely', () => {
    expect(normalizePersian(null)).toBe('');
    expect(normalizePersian(undefined)).toBe('');
  });
});

describe('parseScore (0–20 scale; junk and unknown -> null)', () => {
  it('parses plain and Persian-decimal values', () => {
    expect(parseScore('18')).toBe(18);
    expect(parseScore('۱۳.۵')).toBe(13.5);
    expect(parseScore('20')).toBe(20);
  });
  it('treats "?" as unknown', () => {
    expect(parseScore('?')).toBeNull();
  });
  it('rejects out-of-scale junk found in the real dataset', () => {
    expect(parseScore('۱۰۰۰۰۰۰۰۰')).toBeNull();
    expect(parseScore('۱۰۰')).toBeNull();
    expect(parseScore('1000')).toBeNull();
    expect(parseScore('-1')).toBeNull();
  });
  it('treats non-numeric and empty as unknown', () => {
    expect(parseScore('abc')).toBeNull();
    expect(parseScore('')).toBeNull();
    expect(parseScore(null)).toBeNull();
  });
  it('keeps boundary values 0 and 20', () => {
    expect(parseScore('0')).toBe(0);
    expect(parseScore('۲۰')).toBe(20);
  });
});

describe('toSearchable (null-safety + display preservation)', () => {
  it('preserves display strings and adds normalized copies', () => {
    const s = toSearchable({ id: 7, professor: 'محمدي', course: 'كامپیوتر', text: 'متن', Link: 'https://t.me/x', Professor_Score: '۱۸', Student_Score: '?' });
    expect(s.professor).toBe('محمدي'); // original preserved for display
    expect(s._professorNorm).toBe(normalizePersian('محمدي'));
    expect(s._professorScore).toBe(18);
  });
  it('does not throw on null/missing fields (RELY-001 fixture)', () => {
    const s = toSearchable({ id: 2, professor: null, course: null, text: null, Link: null, Professor_Score: null, Student_Score: null });
    expect(s.professor).toBe('');
    expect(s.course).toBe('');
    expect(s.text).toBe('');
    expect(s.Professor_Score).toBe('?');
    expect(s.Student_Score).toBe('?');
  });
});

describe('filterAndSort', () => {
  const base = [
    { id: 1, professor: 'علی رضایی', course: 'ریاضی', text: 'خوب', Link: 'https://t.me/1', Professor_Score: '10', Student_Score: '15' },
    { id: 2, professor: 'مریم محمدی', course: 'كامپیوتر', text: 'متوسط', Link: 'https://t.me/2', Professor_Score: '۱۸', Student_Score: '16' },
    { id: 3, professor: 'حسن کاظمی', course: 'فیزیک', text: 'بد', Link: 'https://t.me/3', Professor_Score: '?', Student_Score: '10' },
    { id: 4, professor: 'سارا رضایی', course: 'شیمی', text: 'خوب', Link: 'https://t.me/4', Professor_Score: '۱۰۰۰۰۰', Student_Score: '12' },
  ];
  const data = base.map(toSearchable);

  it('sorts by newest (id desc) by default — chronological per dataset contract', () => {
    const out = filterAndSort(data, '', 'newest');
    expect(out.map((x) => x.id)).toEqual([4, 3, 2, 1]);
  });
  it('score sort: valid scores desc, junk/unknown last, id desc tiebreak', () => {
    const out = filterAndSort(data, '', 'score');
    // id2: 18 valid; id1: 10 valid; id3 "?" unknown; id4 100000 out of scale -> unknown.
    // id3 and id4 are both unknown, so the newest-first tiebreak puts id4 before id3.
    expect(out.map((x) => x.id)).toEqual([2, 1, 4, 3]);
  });
  it('matches a Persian query against Arabic-form dataset text (SRCH-002)', () => {
    const out = filterAndSort(data, 'کامپیوتر', 'newest'); // Persian Kaf typed by user
    expect(out.map((x) => x.id)).toEqual([2]); // dataset has Arabic Kaf كامپیوتر
  });
  it('matches Arabic Yeh query against Persian-form dataset text', () => {
    // Build the Arabic-Yeh query via code points so the fixture itself cannot
    // silently contain the visually-identical Persian Yeh.
    const arabicYeh = String.fromCharCode(0x064A);
    const query = 'محمد' + arabicYeh;
    expect(normalizePersian(query)).toBe(normalizePersian('محمدی'));
    const out = filterAndSort(data, query, 'newest');
    expect(out.map((x) => x.id)).toEqual([2]);
  });
  it('matches partial professor names', () => {
    const out = filterAndSort(data, 'رضایی', 'newest');
    expect(out.map((x) => x.id)).toEqual([4, 1]);
  });
  it('treats whitespace-only input as no query (SRCH-003)', () => {
    const out = filterAndSort(data, '   ', 'newest');
    expect(out.length).toBe(4);
  });
  it('returns empty array for nonsense queries', () => {
    expect(filterAndSort(data, 'زیبقشکمث', 'newest')).toEqual([]);
  });
  it('does not mutate the input array (dataset preserved)', () => {
    const snapshot = data.map((x) => x.id);
    filterAndSort(data, 'رضایی', 'score');
    expect(data.map((x) => x.id)).toEqual(snapshot);
  });
  it('handles null course/professor without throwing (RELY-001)', () => {
    const weird = [
      { id: 9, professor: null, course: null, text: null, Link: null, Professor_Score: null, Student_Score: null },
    ].map(toSearchable);
    expect(() => filterAndSort(weird, 'رضا', 'score')).not.toThrow();
    expect(() => filterAndSort(weird, '', 'score')).not.toThrow();
    expect(filterAndSort(weird, '', 'score').length).toBe(1);
  });
});
