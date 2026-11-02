/**
 * Dataset schema validation, record preservation, and integrity (Phase IV).
 *
 * CORE PRINCIPLE (Phase IV mission §7): the classic تجربیات directory maps
 * EVERY source record to exactly one view-model — classicDirectoryCount ===
 * sourceRecordCount — regardless of missing ids, empty text, unknown scores,
 * duplicates, or unexpected fields. Per-feature eligibility is separate:
 * a record may be excluded from one derived feature (with a counted reason)
 * while remaining fully visible in the classic directory.
 *
 * Identity (mission §7.3): records with a finite numeric source id use
 * `String(id)` as their app identity (preserving every existing deep link).
 * Records without one receive a deterministic app-only identity derived from
 * their canonical content plus an occurrence discriminator — never written
 * back to the dataset, never used to overwrite another record.
 *
 * Fingerprints (mission §8.3):
 *  - `datasetFingerprint`: SHA-256 over an unambiguous length-prefixed
 *    canonical serialization — provenance-grade, computed in both runtimes.
 *  - `driftFingerprint`: FNV-1a-64 over the same bytes — a lightweight
 *    non-cryptographic drift check for the browser, labeled as such.
 * Both are implemented byte-identically in tools/nlp_pipeline.py.
 */

export const SCHEMA_VERSION = 2;

const KNOWN_FIELDS = new Set(['id', 'Link', 'course', 'Student_Score', 'Professor_Score', 'professor', 'text']);

const ISSUE_CODES = {
  MISSING_ID: 'missing-id',
  INVALID_ID: 'invalid-id',
  DUPLICATE_ID: 'duplicate-id',
  DUPLICATE_LINK: 'duplicate-link',
  INVALID_LINK: 'invalid-link',
  NON_STRING_FIELD: 'non-string-field',
  UNEXPECTED_FIELD: 'unexpected-field',
  EMPTY_TEXT: 'empty-text',
  WHITESPACE_TEXT: 'whitespace-text',
  MISSING_PROFESSOR: 'missing-professor',
  MISSING_COURSE: 'missing-course',
};

function toDisplayString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** FNV-1a 64 over bytes — non-cryptographic drift fingerprint only. */
export function fnv1a64(bytes) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Canonical serialization: length-prefixed UTF-8 fields with explicit type
 * tags. Delimiter- and ambiguity-proof (a field may contain any character,
 * including the historic ◆/\u001f separators). Field order is the schema
 * contract; array order (append order) is significant and preserved.
 */
export function canonicalRecordBytes(record) {
  const enc = new TextEncoder();
  const field = (tag, value) => {
    const bytes = enc.encode(`${tag}:${value == null ? '~' : String(value)}`);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length);
    return [len, bytes];
  };
  const chunks = [];
  chunks.push(...field('id', record.id));
  chunks.push(...field('prof', record.professor));
  chunks.push(...field('course', record.course));
  chunks.push(...field('ps', record.Professor_Score));
  chunks.push(...field('ss', record.Student_Score));
  chunks.push(...field('txt', record.text));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function sha256Hex(bytes) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return null; // caller falls back to the drift fingerprint
}

function sha256HexSync(bytes) {
  // Node context (tests): use node:crypto when exposed; browser callers use
  // the async path above. Kept synchronous for the test suite only.
  try {
    // eslint-disable-next-line no-undef
    const nodeCrypto = typeof require === 'function' ? require('node:crypto') : null;
    if (nodeCrypto) return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch { /* browser */ }
  return null;
}

/**
 * Validate the dataset and produce the classic-directory view-model for EVERY
 * record, with per-feature eligibility and reconciled counts.
 */
export function validateDataset(rawRecords) {
  const issues = [];
  const counts = {
    total: 0,
    classicDirectory: 0,
    validUniqueNumericIds: 0,
    missingIds: 0,
    invalidIds: 0,
    duplicateIds: 0,
    duplicateLinks: 0,
    withText: 0,
    emptyOrWhitespaceText: 0,
    missingProfessor: 0,
    missingCourse: 0,
    searchEligible: 0,
    topicEligible: 0,
    profileEligible: 0,
    withWarnings: 0,
  };

  if (!Array.isArray(rawRecords)) {
    return {
      ok: false,
      fatal: 'dataset-not-a-list',
      records: [],
      issues: [{ code: 'dataset-not-a-list', identity: null, detail: 'data.json root is not an array' }],
      counts,
      datasetFingerprint: null,
      driftFingerprint: null,
    };
  }

  counts.total = rawRecords.length;
  const records = [];
  const seenIds = new Map();
  const seenLinks = new Map();
  const canonicalOccurrence = new Map();
  const canonicalBytesAll = [];
  const hashParts = [];

  for (let index = 0; index < rawRecords.length; index++) {
    const raw = rawRecords[index];
    const recordNumber = index + 1;
    const recordIssues = [];

    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      const issue = { code: ISSUE_CODES.NON_STRING_FIELD, identity: null, recordNumber, detail: 'record is not an object; classic view falls back to empty fields' };
      issues.push(issue);
      records.push(makeClassicRecord(raw ?? {}, index, recordIssues, `x-nonobject-${index + 1}`));
      counts.classicDirectory += 1; // the invariant holds for non-object rows too
      continue;
    }

    // --- identity (mission §7.3): source id when safe, else app-only ---
    const rawId = raw.id;
    const idIsSafe = typeof rawId === 'number' && Number.isFinite(rawId);
    let identity;
    if (!idIsSafe) {
      recordIssues.push({
        code: rawId == null ? ISSUE_CODES.MISSING_ID : ISSUE_CODES.INVALID_ID,
        identity: null,
        recordNumber,
        detail: 'no finite numeric source id; classic record preserved with an app-only identity',
      });
    } else if (seenIds.has(rawId)) {
      // Duplicate source id: preserve both records under non-conflicting
      // identities — the first keeps the existing deep link, later
      // occurrences get a deterministic discriminator.
      counts.duplicateIds += 1;
      const occurrence = seenIds.get(rawId);
      identity = `${rawId}#dup${occurrence}`;
      seenIds.set(rawId, occurrence + 1);
      recordIssues.push({ code: ISSUE_CODES.DUPLICATE_ID, identity, recordNumber, detail: `shares id with record at position ${occurrence}; both records remain visible` });
    } else {
      seenIds.set(rawId, 1);
      identity = String(rawId);
    }

    // --- canonical fingerprint input (raw field values, append order) ---
    const canonical = {
      id: idIsSafe ? rawId : rawId == null ? null : String(rawId),
      professor: toDisplayString(raw.professor),
      course: toDisplayString(raw.course),
      Professor_Score: toDisplayString(raw.Professor_Score),
      Student_Score: toDisplayString(raw.Student_Score),
      text: toDisplayString(raw.text),
    };
    const canonicalBytes = canonicalRecordBytes(canonical);
    canonicalBytesAll.push(canonicalBytes);
    hashParts.push(canonicalBytes);

    // --- app-only identity for records without a safe source id ---
    if (!idIsSafe) {
      const canonKey = fnv1a64(canonicalBytes).toString(16);
      const occurrence = canonicalOccurrence.get(canonKey) || 0;
      canonicalOccurrence.set(canonKey, occurrence + 1);
      identity = `x-${canonKey}-o${occurrence}`;
    }

    // --- fields (coerced for display; raw values untouched in data.json) ---
    const professor = toDisplayString(raw.professor);
    const course = toDisplayString(raw.course);
    const text = toDisplayString(raw.text);
    const professorScore = typeof raw.Professor_Score === 'string' ? raw.Professor_Score : professorScoreFallback(raw.Professor_Score);
    const studentScore = typeof raw.Student_Score === 'string' ? raw.Student_Score : studentScoreFallback(raw.Student_Score);

    for (const [fieldName, value] of [['professor', raw.professor], ['course', raw.course], ['text', raw.text], ['Professor_Score', raw.Professor_Score], ['Student_Score', raw.Student_Score]]) {
      if (value != null && typeof value !== 'string') {
        recordIssues.push({ code: ISSUE_CODES.NON_STRING_FIELD, identity, recordNumber, field: fieldName, detail: 'coerced for display; source field untouched' });
      }
    }
    for (const key of Object.keys(raw)) {
      if (!KNOWN_FIELDS.has(key)) {
        recordIssues.push({ code: ISSUE_CODES.UNEXPECTED_FIELD, identity, recordNumber, field: key, detail: 'unknown additive field tolerated' });
      }
    }

    const link = typeof raw.Link === 'string' ? raw.Link : '';
    if (link && !/^https?:\/\//i.test(link)) {
      recordIssues.push({ code: ISSUE_CODES.INVALID_LINK, identity, recordNumber, field: 'Link', detail: 'not http(s); rendered as unavailable' });
    }
    if (link && seenLinks.has(link)) {
      counts.duplicateLinks += 1;
      recordIssues.push({ code: ISSUE_CODES.DUPLICATE_LINK, identity, recordNumber, field: 'Link', detail: `duplicate of identity ${seenLinks.get(link)}` });
    } else if (link) {
      seenLinks.set(link, identity);
    }

    // --- per-feature eligibility (mission §7.2) ---
    const hasText = text.trim() !== '';
    const hasProfessor = professor.trim() !== '';
    const hasCourse = course.trim() !== '';
    if (!hasText) {
      recordIssues.push({ code: text === '' ? ISSUE_CODES.EMPTY_TEXT : ISSUE_CODES.WHITESPACE_TEXT, identity, recordNumber, field: 'text', detail: 'classic directory still shows this record; full-text features exclude it' });
    }
    if (!hasProfessor) recordIssues.push({ code: ISSUE_CODES.MISSING_PROFESSOR, identity, recordNumber, field: 'professor', detail: 'shown as unknown; profile grouping excludes it' });
    if (!hasCourse) recordIssues.push({ code: ISSUE_CODES.MISSING_COURSE, identity, recordNumber, field: 'course', detail: 'shown as unknown; profile grouping excludes it' });

    counts.classicDirectory += 1; // invariant: every record is classic-visible
    if (idIsSafe) counts.validUniqueNumericIds += 1;
    if (!idIsSafe) counts[rawId == null ? 'missingIds' : 'invalidIds'] += 1;
    if (hasText) counts.withText += 1; else counts.emptyOrWhitespaceText += 1;
    if (!hasProfessor) counts.missingProfessor += 1;
    if (!hasCourse) counts.missingCourse += 1;
    if (hasText) { counts.searchEligible += 1; counts.topicEligible += 1; }
    if (hasProfessor || hasCourse) counts.profileEligible += 1;
    if (recordIssues.length > 0) counts.withWarnings += 1;
    issues.push(...recordIssues);

    records.push({
      identity, // app-only identity: String(id) or synthetic
      sourceId: idIsSafe ? rawId : null,
      id: idIsSafe ? rawId : null, // backward-compatible numeric id (null when absent)
      Link: link,
      professor, course, text,
      // display contract keeps the source's PascalCase score fields
      Professor_Score: professorScore,
      Student_Score: studentScore,
      eligibility: {
        directory: true,
        search: hasText,
        topics: hasText,
        profiles: hasProfessor || hasCourse,
      },
      warnings: recordIssues,
      recordNumber,
    });
  }

  return {
    ok: true,
    fatal: null,
    records,
    issues,
    counts,
    datasetFingerprint: null, // filled by the async finishDatasetFingerprint
    driftFingerprint: fnv1a64(joinBytes(hashParts)),
    canonicalBytes: joinBytes(hashParts),
  };
}

function professorScoreFallback(v) { return v == null ? '?' : toDisplayString(v); }
function studentScoreFallback(v) { return v == null ? '?' : toDisplayString(v); }

function joinBytes(byteArrays) {
  const total = byteArrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of byteArrays) { out.set(b, offset); offset += b.length; }
  return out;
}

function makeClassicRecord(raw, index, warnings, identity) {
  // Non-object rows still get a classic-directory entry (empty fields).
  return {
    identity,
    sourceId: null,
    id: null,
    Link: '',
    professor: '', course: '', text: '', professorScore: '?', studentScore: '?',
    eligibility: { directory: true, search: false, topics: false, profiles: false },
    warnings,
    recordNumber: index + 1,
  };
}

/**
 * Compute the SHA-256 dataset fingerprint over the canonical bytes
 * (provenance-grade). Async because browsers expose SHA-256 via WebCrypto.
 * The Python pipeline produces the identical hex string.
 */
export async function finishDatasetFingerprint(validation) {
  if (!validation || !validation.canonicalBytes) return null;
  const hex = await sha256Hex(validation.canonicalBytes);
  return hex || fnv1a64(validation.canonicalBytes); // extreme fallback: drift fingerprint
}

export { sha256HexSync };
