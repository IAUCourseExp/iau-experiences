#!/usr/bin/env node
/**
 * Phase III §20 acceptance-matrix fixture generator.
 *
 * 20 source mutations × 10 text shapes = 200 fixture datasets, each derived
 * from a fixed stratified sample of the REAL dataset (never mutating the
 * protected production data.json). Every fixture records its provenance and
 * the exact appended records so the stage runners can assert per-scenario
 * invariants.
 *
 * Usage: node tools/matrix/generate-fixtures.mjs [--out tools/matrix/fixtures]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT_DIR = path.resolve(__dirname, outArg !== -1 ? args[outArg + 1] : '../fixtures');
const ROOT = path.resolve(__dirname, '../..');

const MUTATIONS = [
  'append-one-record', 'append-batch', 'new-professor', 'new-course', 'new-theme',
  'orthographic-variant', 'zwnj-variant', 'persian-digits', 'arabic-digits', 'latin-digits',
  'boundary-score-twenty', 'boundary-score-zero', 'invalid-score-negative', 'invalid-score-overflow',
  'missing-score', 'empty-review', 'whitespace-review', 'long-review', 'extreme-review', 'lexical-novelty',
];

const SHAPES = ['short', 'medium', 'long', 'very-long', 'sparse', 'noisy', 'negated', 'orthographic', 'multilingual', 'ambiguous'];

// Stratified deterministic base sample: first 30 records (oldest), 30 from the
// middle, last 30 (newest) — 90 records covering the corpus' real variety.
function baseSample(data) {
  const withText = data.filter((r) => (r.text || '').trim().length > 20);
  const n = withText.length;
  const pick = (from, to, count) => withText.slice(from, to).filter((_, i) => i % Math.max(1, Math.floor((to - from) / count)) === 0).slice(0, count);
  return [...pick(0, Math.floor(n / 3), 30), ...pick(Math.floor(n / 3), Math.floor((2 * n) / 3), 30), ...pick(Math.floor((2 * n) / 3), n, 30)];
}

const NOVEL_THEME_TEXTS = [
  'آزمایشگاه دانشگاه تجهیزات نو خریداری کرده و هر جلسه آزمایش عملی انجام می‌دهیم. گزارشکار گروهی است و نمره مازاد دارد.',
  'کارگاه حرفه‌ای برگزار می‌شود و هر دانشجو یک پروژه کوچک الکترونیکی می‌سازد. وسایل کار در اختیار همه گذاشته می‌شود.',
  'بخش عملی درس در سایت کامپیوتری دانشگاه برگزار می‌شود و شبیه‌سازی صنعتی انجام می‌دهیم.',
];

function shapeText(base, shape) {
  switch (shape) {
    case 'short': return base.slice(0, 40) || 'خوب بود';
    case 'medium': return base.length > 150 ? base.slice(0, 150) : base + ' ' + base;
    case 'long': return (base + ' ').repeat(8).trim();
    case 'very-long': return (base + ' ').repeat(40).trim();
    case 'sparse': return base.split(/\s+/)[0] || 'خوب';
    case 'noisy': return base + ' !!! 😅🔥👍 ??? … ۱۲۳';
    case 'negated': return base + ' اما استاد بی‌انصافی نمی‌کند و نمره نمی‌دهد نمی‌خواهم بگویم بد بود ولی نمی‌پسندم.';
    case 'orthographic': return base.replace(/ی/g, 'ي').replace(/ک/g, 'ك');
    case 'multilingual': return base + ' Overall the course was useful, professor "Dr. Smith" taught MATLAB and Python too.';
    case 'ambiguous': return base + ' ممکن است خوب باشد ممکن هم نیست؛ بستگی دارد، شاید.';
    default: return base;
  }
}

function applyMutation(mutation, shape, base, nextId, sampleText) {
  const appended = [];
  const add = (record) => appended.push({ id: nextId + appended.length, Link: `https://t.me/IAUCourseExp/9${nextId + appended.length}`, course: record.course ?? 'درس نمونه', Student_Score: record.Student_Score ?? '?', Professor_Score: record.Professor_Score ?? '?', professor: record.professor ?? 'استاد نمونه', text: record.text ?? '' });
  const shaped = shapeText(sampleText, shape);

  switch (mutation) {
    case 'append-one-record':
      add({ text: shaped });
      break;
    case 'append-batch':
      for (let i = 0; i < 5; i++) add({ text: `${shaped} بخش ${i + 1}`, professor: `استاد نمونه ${i % 2 === 0 ? 'الف' : 'ب'}` });
      break;
    case 'new-professor':
      add({ professor: 'پروفسور تازه‌وارد آزمایشی', text: shaped, course: 'درس نمونه' });
      break;
    case 'new-course':
      add({ course: 'درس آزمایشی کاملاً نو', text: shaped });
      break;
    case 'new-theme':
      NOVEL_THEME_TEXTS.forEach((t) => add({ text: shapeText(t, shape), professor: 'استاد آزمایشگاه نمونه', course: 'آزمایشگاه فناوری نوین' }));
      break;
    case 'orthographic-variant': {
      // Arabic-keyboard variant of an existing frequent professor
      const target = base.find((r) => (r.professor || '').trim().length > 3);
      const name = (target?.professor || 'علی رضایی').trim().replace(/ی/g, 'ي').replace(/ک/g, 'ك');
      add({ professor: name, text: shaped, course: target?.course || 'درس نمونه' });
      break;
    }
    case 'zwnj-variant':
      add({ text: shaped.replace(/ /g, '\u200C'), professor: 'استاد\u200Cنمونه' });
      break;
    case 'persian-digits':
      add({ text: shaped, Student_Score: '۱۸', Professor_Score: '۱۹' });
      break;
    case 'arabic-digits':
      add({ text: shaped, Student_Score: '١٨', Professor_Score: '١٩' });
      break;
    case 'latin-digits':
      add({ text: shaped, Student_Score: '18', Professor_Score: '19' });
      break;
    case 'boundary-score-twenty':
      add({ text: shaped, Student_Score: '20', Professor_Score: '۲۰' });
      break;
    case 'boundary-score-zero':
      add({ text: shaped, Student_Score: '0', Professor_Score: '۰' });
      break;
    case 'invalid-score-negative':
      add({ text: shaped, Student_Score: '-5', Professor_Score: '-۱' });
      break;
    case 'invalid-score-overflow':
      add({ text: shaped, Student_Score: '150', Professor_Score: '۱۰۰۰۰۰' });
      break;
    case 'missing-score': {
      const r = { text: shaped, professor: 'استاد بی‌نمره', course: 'درس نمونه' };
      add(r);
      // remove the score fields entirely from the last appended record
      delete appended[appended.length - 1].Student_Score;
      delete appended[appended.length - 1].Professor_Score;
      break;
    }
    case 'empty-review':
      add({ text: '' });
      break;
    case 'whitespace-review':
      add({ text: '    ' });
      break;
    case 'long-review':
      add({ text: shapeText('تجربه بلند اما واقعی درباره این درس و استاد. ', 'long') + shaped });
      break;
    case 'extreme-review': {
      const weird = `${shaped} <script>alert("x")</script> 🎲🧠 ${'ط'.repeat(500)} ${'A'.repeat(300)} \u202Ereversed\u202C`;
      add({ text: weird.slice(0, 10000) });
      break;
    }
    case 'lexical-novelty':
      add({ text: `${shaped} زنبورک آبی در فضای کوانتومی شناور بود` });
      break;
    default:
      throw new Error(`unknown mutation ${mutation}`);
  }
  return appended;
}

// Deterministic sample text per shape (real corpus sentence as seed)
const SEED_TEXT = 'استاد خوبی هستن، حضور و غیاب مهم نیست، امتحانش هم از جزوه می‌باشد و پروژه‌ای نداریم.';

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data.json'), 'utf8'));
const base = baseSample(data);
const maxExistingId = Math.max(...data.map((r) => r.id));

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
let fixtureIndex = 0;
for (const mutation of MUTATIONS) {
  for (const shape of SHAPES) {
    fixtureIndex += 1;
    const id = `P3F-${String(fixtureIndex).padStart(3, '0')}`;
    const fixtureRecords = base.map((r) => ({ ...r }));
    const appended = applyMutation(mutation, shape, fixtureRecords, maxExistingId + 1, SEED_TEXT);
    fixtureRecords.push(...appended);
    const fixture = { id, mutation, shape, appended, records: fixtureRecords };
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(fixture, null, 1), 'utf8');
    manifest.push({ id, mutation, shape, appendedCount: appended.length, appendedIds: appended.map((a) => a.id), file: `${id}.json` });
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
  generatedFrom: 'src/data.json (fixed stratified sample; production data untouched)',
  baseRecords: base.length,
  totalFixtures: manifest.length,
  fixtures: manifest,
}, null, 2), 'utf8');

console.log(`generated ${manifest.length} fixtures in ${OUT_DIR}`);
