import { normalizePersian } from './search.js';

/**
 * Experience profile aggregation (Feature 1).
 *
 * Grouping rule (deliberately conservative, mission §3.5):
 *   - Records are grouped by the EXACT normalized name (normalizePersian:
 *     Arabic/Persian letter variants, digits, ZWNJ, diacritics, whitespace).
 *   - No fuzzy merging: two similar-but-different names are NEVER combined.
 *   - Verified against the real dataset: 1,015 raw professor names collapse to
 *     1,005 groups and 454 course names to 435 groups — every merged pair is a
 *     pure orthographic variant of the same name (Arabic Yeh/Kaf, ZWNJ
 *     placement). No ambiguous merges exist.
 *   - The displayed name is the most frequent raw spelling in the group
 *     (tie-break: spelling of the record with the lowest id) — deterministic.
 */

// Arabic-form letters that a canonical Persian spelling would not contain.
const ARABIC_FORM_RE = /[\u064A\u0649\u0643\u0629\u0624\u0623\u0625\u0671]/g;

function arabicFormCount(raw) {
  return (raw.match(ARABIC_FORM_RE) || []).length;
}

/**
 * Deterministic display-name choice:
 *  1. most frequent raw spelling,
 *  2. on a tie, the spelling with fewer Arabic-form letters (ی/ی ي, ک/ك —
 *     canonical Persian spellings win over accidental Arabic-keyboard forms),
 *  3. still tied → the spelling of the record with the lowest id.
 */
function pickDisplayName(variants, recordsById) {
  let best = null;
  for (const [raw, count] of variants) { // variants is a Map<raw, count>
    if (!best) {
      best = { raw, count };
      continue;
    }
    if (count !== best.count) {
      if (count > best.count) best = { raw, count };
      continue;
    }
    const arabicDiff = arabicFormCount(raw) - arabicFormCount(best.raw);
    if (arabicDiff < 0) {
      best = { raw, count };
    } else if (arabicDiff === 0) {
      const a = recordsById.get(raw);
      const b = recordsById.get(best.raw);
      if (a !== undefined && b !== undefined && a < b) best = { raw, count };
    }
  }
  return best ? best.raw : '';
}

function buildGroups(searchable, getField) {
  const map = new Map(); // normKey -> { variants: Map<raw,count>, firstId: Map<raw,id>, records: [] }
  for (const item of searchable) {
    const raw = getField(item).trim();
    if (!raw) continue; // records without a name are not grouped (counted separately by callers)
    const key = normalizePersian(raw);
    let group = map.get(key);
    if (!group) {
      group = { key, variants: new Map(), firstIds: new Map(), records: [] };
      map.set(key, group);
    }
    group.variants.set(raw, (group.variants.get(raw) || 0) + 1);
    if (!group.firstIds.has(raw)) group.firstIds.set(raw, item.id);
    group.records.push(item);
  }
  const groups = [...map.values()].map((g) => ({
    key: g.key,
    name: pickDisplayName(g.variants, g.firstIds),
    rawVariants: [...g.variants.keys()],
    records: g.records.sort((a, b) => b.id - a.id),
  }));
  groups.sort((a, b) => b.records.length - a.records.length || a.name.localeCompare(b.name, 'fa'));
  return groups;
}

/** Five readable bins over the real 0–20 scale. */
export const SCORE_BINS = [
  { label: '۰ تا ۴', min: 0, max: 4 },
  { label: '۵ تا ۸', min: 5, max: 8 },
  { label: '۹ تا ۱۲', min: 9, max: 12 },
  { label: '۱۳ تا ۱۶', min: 13, max: 16 },
  { label: '۱۷ تا ۲۰', min: 17, max: 20 },
];

/**
 * Descriptive statistics over VALID parsed scores (0–20). Unknown/invalid
 * values are never treated as zero — they are only counted, never averaged.
 */
export function scoreStats(validScores) {
  const n = validScores.length;
  if (n === 0) {
    return { validCount: 0, avg: null, median: null, min: null, max: null, distribution: SCORE_BINS.map(() => 0) };
  }
  const sorted = [...validScores].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const distribution = SCORE_BINS.map(
    (bin) => sorted.filter((v) => v >= bin.min && v <= bin.max).length
  );
  return {
    validCount: n,
    avg: sum / n,
    median,
    min: sorted[0],
    max: sorted[n - 1],
    distribution,
  };
}

function withStats(records) {
  const profScores = records.map((r) => r._professorScore).filter((v) => v != null);
  const studentScores = records.map((r) => r._studentScore).filter((v) => v != null);
  return {
    totalCount: records.length,
    professorStats: scoreStats(profScores),
    studentStats: scoreStats(studentScores),
  };
}

/**
 * Build professor profiles from the searchable view-model.
 * `_studentScore` is parsed lazily by the caller via `toSearchable` extension
 * (see search.js) so both score fields share one parsing pass.
 */
export function buildProfessorProfiles(searchable, courseNameResolver) {
  const groups = buildGroups(searchable, (item) => item.professor);
  return groups.map((g) => {
    const courseKeys = new Map();
    for (const r of g.records) {
      const raw = r.course.trim();
      if (!raw) continue;
      const key = normalizePersian(raw);
      if (!courseKeys.has(key)) courseKeys.set(key, { key, name: raw, count: 0 });
      courseKeys.get(key).count += 1;
    }
    const courses = [...courseKeys.values()]
      .map((c) => ({ ...c, name: (courseNameResolver && courseNameResolver(c.key)) || c.name }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fa'));
    return { ...g, courses, ...withStats(g.records) };
  });
}

export function buildCourseProfiles(searchable, professorNameResolver) {
  const groups = buildGroups(searchable, (item) => item.course);
  return groups.map((g) => {
    const profKeys = new Map();
    for (const r of g.records) {
      const raw = r.professor.trim();
      if (!raw) continue;
      const key = normalizePersian(raw);
      if (!profKeys.has(key)) profKeys.set(key, { key, name: raw, count: 0 });
      profKeys.get(key).count += 1;
    }
    const professors = [...profKeys.values()]
      .map((p) => ({ ...p, name: (professorNameResolver && professorNameResolver(p.key)) || p.name }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fa'));
    return { ...g, professors, ...withStats(g.records) };
  });
}

/**
 * Build both profile dimensions with canonical cross-references: a course
 * profile always shows the professor's canonical profile name and vice versa.
 */
export function buildProfiles(searchable) {
  const professors = buildProfessorProfiles(searchable);
  const profResolver = indexByKey(professors);
  const courses = buildCourseProfiles(
    searchable,
    (key) => profResolver.get(key)?.name
  );
  const courseResolver = indexByKey(courses);
  for (const p of professors) {
    for (const c of p.courses) {
      c.name = courseResolver.get(c.key)?.name || c.name;
    }
  }
  return {
    professors,
    courses,
    professorByKey: indexByKey(professors),
    courseByKey: indexByKey(courses),
  };
}

/**
 * Filter and sort the professor directory.
 *
 * Important:
 * - Searches professor names and their associated course names.
 * - Uses only valid parsed professor scores.
 * - Never interprets missing scores as zero.
 * - Average-score sorting prioritizes profiles with at least 5 valid scores.
 * - This is descriptive browsing, not an official professor ranking.
 */
export function filterAndSortProfessors(
  profiles,
  {
    query = '',
    courseKey = '',
    ratedOnly = false,
    minValidScores = 0,
    sortBy = 'experience',
  } = {}
) {
  const normalizedQuery = normalizePersian(query);

  const requestedMinimum = Number(minValidScores);
  const minimum = Number.isFinite(requestedMinimum)
    ? Math.max(0, requestedMinimum)
    : 0;

  const getValidCount = (profile) =>
    profile.professorStats?.validCount ?? 0;

  const getAverage = (profile) =>
    profile.professorStats?.avg ?? null;

  const compareName = (a, b) =>
    a.name.localeCompare(b.name, 'fa') ||
    a.key.localeCompare(b.key);

  const compareExperienceCount = (a, b) =>
    b.totalCount - a.totalCount ||
    compareName(a, b);

  const compareScore = (a, b, direction) => {
    const aCount = getValidCount(a);
    const bCount = getValidCount(b);

    const aReliable = aCount >= 5;
    const bReliable = bCount >= 5;

    // A profile with at least 5 valid scores is considered first.
    // This avoids placing a 1-score profile above a 20-score profile
    // merely because its average happens to be higher.
    if (aReliable !== bReliable) {
      return aReliable ? -1 : 1;
    }

    const aAverage = getAverage(a);
    const bAverage = getAverage(b);

    if (aAverage == null && bAverage != null) return 1;
    if (aAverage != null && bAverage == null) return -1;

    if (aAverage !== bAverage) {
      return direction * (aAverage - bAverage);
    }

    return (
      bCount - aCount ||
      compareExperienceCount(a, b)
    );
  };

  const filtered = profiles.filter((profile) => {
    if (normalizedQuery) {
      const searchableText = [
        profile.name,
        ...profile.courses.map((course) => course.name),
      ]
        .map(normalizePersian)
        .join(' ');

      if (!searchableText.includes(normalizedQuery)) {
        return false;
      }
    }

    if (
      courseKey &&
      !profile.courses.some((course) => course.key === courseKey)
    ) {
      return false;
    }

    const validCount = getValidCount(profile);

    if (ratedOnly && validCount === 0) {
      return false;
    }

    if (validCount < minimum) {
      return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'score-high':
        return compareScore(a, b, -1);

      case 'score-low':
        return compareScore(a, b, 1);

      case 'score-count':
        return (
          getValidCount(b) - getValidCount(a) ||
          compareExperienceCount(a, b)
        );

      case 'name':
        return compareName(a, b);

      case 'experience':
      default:
        return compareExperienceCount(a, b);
    }
  });

  return filtered;
}

/** Index profiles by their stable normalized key for O(1) deep-link lookup. */
export function indexByKey(profiles) {
  return new Map(profiles.map((p) => [p.key, p]));
}
