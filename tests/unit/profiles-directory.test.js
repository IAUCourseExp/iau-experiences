import { describe, it, expect } from 'vitest';
import { normalizePersian } from '../../src/lib/search.js';
import {
  filterAndSortProfessors,
} from '../../src/lib/profiles.js';

function makeProfessor({
  name,
  totalCount,
  validCount,
  average,
  courses = [],
}) {
  return {
    key: normalizePersian(name),
    name,
    totalCount,
    courses: courses.map((course) => ({
      key: normalizePersian(course),
      name: course,
      count: 1,
    })),
    professorStats: {
      validCount,
      avg: average,
    },
  };
}

const profiles = [
  makeProfessor({
    name: 'علی رضایی',
    totalCount: 30,
    validCount: 10,
    average: 16,
    courses: ['ریاضی عمومی', 'آمار'],
  }),

  makeProfessor({
    name: 'محمد احمدی',
    totalCount: 12,
    validCount: 1,
    average: 20,
    courses: ['ریاضی عمومی'],
  }),

  makeProfessor({
    name: 'رضا کریمی',
    totalCount: 40,
    validCount: 15,
    average: 18,
    courses: ['برنامه‌نویسی'],
  }),

  makeProfessor({
    name: 'حسین محمدی',
    totalCount: 8,
    validCount: 0,
    average: null,
    courses: ['آمار'],
  }),
];

describe('professor directory filtering', () => {
  it('searches professor names', () => {
    const result = filterAndSortProfessors(profiles, {
      query: 'رضایی',
    });

    expect(result.map((p) => p.name)).toEqual(['علی رضایی']);
  });

  it('searches associated course names', () => {
    const result = filterAndSortProfessors(profiles, {
      query: 'برنامه‌نویسی',
    });

    expect(result.map((p) => p.name)).toEqual(['رضا کریمی']);
  });

  it('filters professors by exact course key', () => {
    const result = filterAndSortProfessors(profiles, {
      courseKey: normalizePersian('آمار'),
    });

    // Membership assertion: sort both sides with the same comparator so the
    // check is order-insensitive and deterministic across collations.
    expect(
      result.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'fa'))
    ).toEqual(
      ['علی رضایی', 'حسین محمدی'].sort((a, b) => a.localeCompare(b, 'fa'))
    );
  });

  it('ratedOnly excludes profiles without valid professor scores', () => {
    const result = filterAndSortProfessors(profiles, {
      ratedOnly: true,
    });

    expect(result.some((p) => p.name === 'حسین محمدی')).toBe(false);
  });

  it('minimum sample size excludes small score samples', () => {
    const result = filterAndSortProfessors(profiles, {
      minValidScores: 5,
    });

    // Membership assertion: sort both sides with the same comparator so the
    // check is order-insensitive and deterministic across collations.
    expect(
      result.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'fa'))
    ).toEqual(
      ['علی رضایی', 'رضا کریمی'].sort((a, b) => a.localeCompare(b, 'fa'))
    );
  });

  it('score sorting prioritizes profiles with at least five valid scores', () => {
    const result = filterAndSortProfessors(profiles, {
      sortBy: 'score-high',
    });

    expect(result.map((p) => p.name)).toEqual([
      'رضا کریمی',
      'علی رضایی',
      'محمد احمدی',
      'حسین محمدی',
    ]);
  });

  it('score-count sorting prioritizes the number of valid scores', () => {
    const result = filterAndSortProfessors(profiles, {
      sortBy: 'score-count',
    });

    expect(result.map((p) => p.name)).toEqual([
      'رضا کریمی',
      'علی رضایی',
      'محمد احمدی',
      'حسین محمدی',
    ]);
  });

  it('alphabetical sorting is deterministic', () => {
    const result = filterAndSortProfessors(profiles, {
      sortBy: 'name',
    });

    expect(result.map((p) => p.name)).toEqual(
      [...profiles]
        .sort((a, b) => a.name.localeCompare(b.name, 'fa'))
        .map((p) => p.name)
    );
  });

  it('does not mutate the original input array', () => {
    const original = [...profiles];

    filterAndSortProfessors(profiles, {
      sortBy: 'score-high',
    });

    expect(profiles).toEqual(original);
  });
});
