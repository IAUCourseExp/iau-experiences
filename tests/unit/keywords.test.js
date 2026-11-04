import { describe, it, expect } from 'vitest';
import { normalizePersian } from '../../src/lib/search.js';
import {
  tokenizeNorm,
  recordPhrases,
  phraseDocumentFrequency,
  buildKeywordInsights,
  chipQuery,
  STOPWORDS,
  GENERIC_EVALUATIVE_TERMS,
} from '../../src/lib/keywords.js';

const norm = (text) => normalizePersian(text);
const idx = (records) => records.map((text, i) => ({ id: String(i + 1), textNorm: norm(text) }));

describe('tokenize + phrase extraction', () => {
  it('keeps connectives so corpus expressions reconstruct exactly', () => {
    expect(tokenizeNorm(norm('حضور و غیاب'))).toEqual(['حضور', 'و', 'غیاب']);
  });

  it('reconstructs «حضور و غیاب» exactly as it appears in normalized text', () => {
    const phrases = recordPhrases(norm('حضور و غیاب دارد'));
    expect(phrases.has('حضور و غیاب')).toBe(true);
  });

  it('never forms a phrase that starts or ends with a stopword', () => {
    const phrases = recordPhrases(norm('خوش اخلاق و منظم بود'));
    expect(phrases.has('خوش اخلاق و')).toBe(false);
    expect(phrases.has('و منظم')).toBe(false);
    expect(phrases.has('خوش اخلاق')).toBe(true);
  });

  it('phrases never span clause boundaries (sentence punctuation)', () => {
    const phrases = recordPhrases(norm('سخت گیر است.امتحان سخت بود'));
    // any phrase containing tokens from both sides of the period must not exist
    const crossClause = [...phrases].filter((p) => p.includes('است امتحان') || p.includes('گیر است امتحان'));
    expect(crossClause).toEqual([]);
  });
});

describe('document frequency counts DISTINCT reports', () => {
  it('repetition inside one record never inflates the count', () => {
    const records = [
      'حضور غیاب دارد حضور غیاب میگیره حضور غیابش زیاده',
      'حضور غیاب نداره',
    ];
    const df = phraseDocumentFrequency(idx(records));
    expect(df.get('حضور غیاب').df).toBe(2);
  });

  it('counts one per record containing the expression', () => {
    const records = ['حضور غیاب یک', 'حضور غیاب دو', 'موضوع دیگر'];
    const df = phraseDocumentFrequency(idx(records));
    expect(df.get('حضور غیاب').df).toBe(2);
  });
});

describe('buildKeywordInsights — selection quality', () => {
  const records = [
    'حضور و غیاب دارد و سخت گیر است',
    'حضور و غیاب مهمه براش',
    'حضور غیاب نداره و خوش اخلاقه',
    'حضور غیاب سخته',
    'درس خوب بود ولی امتحانش سخت بود',
    'امتحانش سخت بود امتحان سخت',
  ];
  const insights = () => buildKeywordInsights(idx(records), { minPhraseDf: 2, minTermDf: 2 });

  it('is deterministic: identical input produces identical output', () => {
    expect(insights()).toEqual(insights());
  });

  it('ranks by distinct-report document frequency', () => {
    const { selected } = insights();
    const dfs = selected.map((s) => s.df);
    expect([...dfs].sort((a, b) => b - a)).toEqual(dfs);
  });

  it('collapses phrase variants with the same content tokens', () => {
    const { selected, excluded } = insights();
    const presence = selected.filter((s) => s.phrase.includes('حضور'));
    const signatures = presence.map((s) => s.phrase.split(' ')
      .filter((t) => !STOPWORDS.has(t)).sort().join('+'));
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(excluded.variantDuplicates).toBeGreaterThanOrEqual(1);
  });

  it('never surfaces a generic evaluative adjective as a lone keyword', () => {
    const { selected } = insights();
    for (const term of GENERIC_EVALUATIVE_TERMS) {
      expect(selected.some((s) => s.phrase === term)).toBe(false);
    }
  });

  it('excludes stopwords and reports the exclusion', () => {
    const { selected, excluded } = insights();
    for (const s of selected) {
      expect(STOPWORDS.has(s.phrase)).toBe(false);
    }
    expect(excluded.stopwordTerms).toBeGreaterThan(0);
  });

  it('every selected phrase has sample record ids', () => {
    const { selected } = insights();
    for (const s of selected) {
      expect(s.sampleIds.length).toBeGreaterThan(0);
      expect(s.sampleIds.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('chipQuery', () => {
  it('wraps the phrase in Persian quotation marks for exact search', () => {
    expect(chipQuery('حضور غیاب')).toBe('«حضور غیاب»');
  });

  it('normalizes Arabic variants so the query matches normalized corpus text', () => {
    expect(chipQuery('سوالات امتحان')).toBe(chipQuery('سوالات امتحان'.replace('س', 'س')));
    // Arabic Kaf in, Persian Kaf out — same normalization as search
    expect(chipQuery('كوییز')).toBe('«کوییز»');
  });
});
