import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search, X, ExternalLink, User, BookOpen, Check, Compass,
  Sparkles, ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import {
  searchFullText, buildHighlightExcerpt, buildTextIndex, buildKeywordFrequency,
} from '../lib/explorer.js';
import { normalizePersian } from '../lib/search.js';
import { loadTopicsArtifact, bindArtifact } from '../lib/atlas.js';
import { professorRoute, courseRoute } from '../lib/router.js';
import ExperienceCard from './ExperienceCard.jsx';

// Capitalized proxies so ESLint's no-unused-vars sees the JSX usage
// (core rule does not count `<motion.article />` member-expression objects).
const MotionArticle = motion.article;

function fa(n) {
  return n.toLocaleString('fa-IR');
}

function Excerpt({ result, entry }) {
  const excerpt = useMemo(
    () => buildHighlightExcerpt(result.item.text, entry.textNorm, result.highlightTerms, 90),
    [result, entry]
  );
  if (!excerpt) {
    return <p className="text-slate-400 text-xs font-bold">این نتیجه بر اساس نام استاد یا درس یافت شد.</p>;
  }
  return (
    <p className="text-slate-600 text-[13px] leading-[1.9] font-medium">
      {excerpt.clippedStart && <span className="text-slate-300">… </span>}
      {excerpt.segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-amber-100/90 text-slate-800 rounded px-0.5">{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
      {excerpt.clippedEnd && <span className="text-slate-300"> …</span>}
    </p>
  );
}

function ResultCard({ result, entry, onOpenExperience }) {
  const { item, matchedIn } = result;
  const prof = item.professor.trim();
  const course = item.course.trim();
  return (
    <MotionArticle
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {prof && (
            <a
              href={professorRoute(normalizePersian(prof))}
              className="inline-flex items-center gap-1 text-sm font-extrabold text-slate-800 hover:text-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded overflow-wrap-anywhere"
            >
              <User size={13} className="text-blue-500 shrink-0" aria-hidden="true" />
              استاد {prof}
            </a>
          )}
          {course && (
            <a
              href={courseRoute(normalizePersian(course))}
              className="inline-flex items-center gap-1 mt-1 text-[11px] font-bold text-blue-700 hover:text-blue-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded overflow-wrap-anywhere"
            >
              <BookOpen size={12} className="shrink-0" aria-hidden="true" />
              {course}
            </a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-100/60 px-2 py-1 rounded-lg">
            ★ {item.Professor_Score}
          </span>
          <span className="text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">
            نمره: {item.Student_Score}
          </span>
        </div>
      </div>

      <Excerpt result={result} entry={entry} />

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100/80">
        <div className="flex items-center gap-1 flex-wrap" aria-label="علت تطابق نتیجه">
          {matchedIn.text && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">در متن تجربه</span>}
          {matchedIn.professor && <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md">در نام استاد</span>}
          {matchedIn.course && <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">در نام درس</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.Link && (
            <a
              href={item.Link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`مشاهده منبع تلگرامی تجربه استاد ${prof || 'نامشخص'}`}
              className="p-2 text-slate-400 hover:text-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-lg"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={() => onOpenExperience(item)}
            className="px-3.5 py-2 bg-blue-50 text-blue-700 text-[11px] font-black rounded-xl hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 min-h-[36px]"
          >
            مشاهده کامل
          </button>
        </div>
      </div>
    </MotionArticle>
  );
}

/**
 * Atlas topic card — corpus-derived theme with full evidence disclosure.
 * Labels are auto-generated at build time; phrases and exemplars are always
 * visible so users can judge the label themselves (mission §6.3).
 */
function TopicCard({ topic, expanded, onToggle, onShowExperiences }) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800 hover:text-blue-700 transition-colors text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded overflow-wrap-anywhere"
        >
          <Compass size={15} className="text-indigo-500 shrink-0" aria-hidden="true" />
          {topic.label}
          {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        <span className="shrink-0 text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-1 rounded-lg whitespace-nowrap">
          {fa(topic.size)} تجربه · {fa(Math.round(topic.share * 100))}٪ کل
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5" aria-label="واژه‌های شاخص این موضوع">
        {topic.phrases.slice(0, 5).map((p) => (
          <span key={p} className="text-[10px] font-bold text-indigo-700 bg-indigo-50/80 border border-indigo-100/60 px-2 py-0.5 rounded-md">{p}</span>
        ))}
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100/80">
          <p className="text-[10px] font-bold text-slate-400 leading-5 mb-3">
            این موضوع به‌صورت خودکار از دل متن تجربه‌ها کشف شده است؛ برچسب آن توسط الگوریتم تولید شده و بازبینی انسانی نشده. واژه‌های شاخص و نمونه‌های واقعی زیر مدرک این برچسب‌اند — قضاوت با شماست.
          </p>
          <button
            type="button"
            onClick={onShowExperiences}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 text-indigo-700 text-xs font-black rounded-xl hover:bg-indigo-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 min-h-[44px]"
          >
            <Sparkles size={14} aria-hidden="true" />
            نمایش {fa(topic.size)} تجربه‌ی این موضوع
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * موضوعات section: corpus-derived topic Atlas (Phase III) + lexical
 * full-text search (Phase II, fixed algorithm — retained).
 *
 * Clarification: "topic Atlas" = build-time TF-IDF + SVD-120 + consensus clustering
 * producing 12 corpus-derived topics with c-TF-IDF labels and evidence phrases.
 * "lexical full-text search" = in-browser normalized substring matching over
 * professor/course/review text (AND semantics). There is NO arbitrary-query
 * semantic/embedding search in the browser — that would require a backend.
 */
export default function ExplorerView({ searchable, datasetChecksum, onOpenExperience }) {
  const [input, setInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [profFilter, setProfFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [knownScoreOnly, setKnownScoreOnly] = useState(false);
  const [studentScoreOnly, setStudentScoreOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const [atlasState, setAtlasState] = useState({ status: 'loading', artifact: null, binding: null });
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const debounceRef = useRef(null);

  // The full-text index is built inside the lazy chunk on first visit —
  // users who never explore never pay for it (mission §9.5).
  const textIndex = useMemo(() => buildTextIndex(searchable), [searchable]);
  const entryById = useMemo(() => new Map(textIndex.map((e) => [e.id, e])), [textIndex]);
  const recordById = useMemo(() => new Map(searchable.map((r) => [r.identity, r])), [searchable]);
  const keywords = useMemo(() => buildKeywordFrequency(textIndex, 24), [textIndex]);

  // Load the build-time artifact once and bind it to the dataset we received.
  useEffect(() => {
    let alive = true;
    loadTopicsArtifact()
      .then((artifact) => {
        if (!alive) return;
        const binding = bindArtifact(artifact, datasetChecksum);
        setAtlasState({ status: 'ready', artifact, binding });
      })
      .catch(() => {
        if (!alive) return;
        setAtlasState({ status: 'error', artifact: null, binding: { bound: false, reason: 'load-failed' } });
      });
    return () => { alive = false; };
  }, [datasetChecksum]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAppliedQuery(input);
      setVisibleCount(30);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [input]);

  const results = useMemo(() => {
    let list;
    if (!appliedQuery.trim()) {
      list = searchable.map((item) => ({
        item,
        matchedIn: { professor: false, course: false, text: false },
        matchedTerms: [],
        highlightTerms: [],
        score: 0,
      }));
    } else {
      list = searchFullText(searchable, textIndex, appliedQuery);
    }
    if (knownScoreOnly) {
      list = list.filter((r) => r.item._professorScore != null);
    }
    if (studentScoreOnly) {
      list = list.filter((r) => r.item._studentScore != null);
    }
    if (profFilter) {
      list = list.filter((r) => r.item._professorNorm === profFilter);
    }
    if (courseFilter) {
      list = list.filter((r) => r.item._courseNorm === courseFilter);
    }
    return list;
  }, [searchable, textIndex, appliedQuery, knownScoreOnly, studentScoreOnly, profFilter, courseFilter]);

  const facetOptions = useMemo(() => {
    let list;
    if (!appliedQuery.trim()) {
      list = searchable.map((item) => ({ item }));
    } else {
      list = searchFullText(searchable, textIndex, appliedQuery);
    }
    if (knownScoreOnly) {
      list = list.filter((r) => r.item._professorScore != null);
    }
    if (studentScoreOnly) {
      list = list.filter((r) => r.item._studentScore != null);
    }
    const profs = new Map();
    const courses = new Map();
    for (const r of list) {
      const ip = r.item.professor.trim();
      const ic = r.item.course.trim();
      if (ip) profs.set(ip, (profs.get(ip) || 0) + 1);
      if (ic) courses.set(ic, (courses.get(ic) || 0) + 1);
    }
    const toSorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fa'));
    return { professors: toSorted(profs), courses: toSorted(courses) };
  }, [searchable, textIndex, appliedQuery, knownScoreOnly, studentScoreOnly]);

  const hasActiveFilters = knownScoreOnly || studentScoreOnly || profFilter || courseFilter;
  const totalDocs = searchable.length;

  function clearFilters() {
    setKnownScoreOnly(false);
    setStudentScoreOnly(false);
    setProfFilter('');
    setCourseFilter('');
  }

  function selectTopic(topic) {
    setSelectedTopic(topic);
    setExpandedTopic(null);
    setVisibleCount(12);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSearchInput(value) {
    if (value !== '' && selectedTopic) setSelectedTopic(null); // typing returns to search mode
    setInput(value);
  }

  const topicsReady = atlasState.status === 'ready' && atlasState.binding?.bound && atlasState.binding.mode === 'semantic';
  const topicsList = topicsReady
    ? [...atlasState.artifact.topics].sort((a, b) => b.size - a.size)
    : [];

  const topicMembers = useMemo(() => {
    if (!selectedTopic) return [];
    return selectedTopic.docIds.map((id) => recordById.get(id)).filter(Boolean);
  }, [selectedTopic, recordById]);

  const listIsTopicMode = selectedTopic != null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 className="text-lg font-black text-slate-800">
          {listIsTopicMode ? `موضوع: ${selectedTopic.label}` : 'جست‌وجو داخل تجربه‌ها'}
        </h1>
        <span className="text-xs font-bold text-slate-600 bg-slate-200/50 px-3 py-1 rounded-full" aria-hidden="true">
          {listIsTopicMode
            ? `${fa(topicMembers.length)} تجربه`
            : `${fa(results.length)} نتیجه`}
        </span>
        <p role="status" className="sr-only">
          {listIsTopicMode
            ? `${fa(topicMembers.length)} تجربه در این موضوع`
            : `${fa(results.length)} نتیجه یافت شد`}
        </p>
      </div>

      {/* Topic member mode */}
      {listIsTopicMode && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setSelectedTopic(null)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[11px] font-bold hover:border-blue-200 hover:text-blue-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 mb-4"
          >
            بازگشت به جست‌وجو
          </button>
          {topicMembers.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {topicMembers.slice(0, visibleCount).map((item) => (
                <ExperienceCard key={item.identity} item={item} onOpen={() => onOpenExperience(item)} />
              ))}
            </div>
          ) : (
            <p className="text-sm font-bold text-slate-500">تجربه‌ای برای این موضوع یافت نشد.</p>
          )}
          {topicMembers.length > visibleCount && (
            <div className="flex justify-center py-6">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 24)}
                className="px-6 py-3 bg-white border border-slate-200 text-blue-600 text-sm font-bold rounded-2xl shadow-sm hover:border-blue-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                نمایش بیشتر
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lexical search (fixed algorithm — Phase II behavior retained) */}
      {!listIsTopicMode && (
        <>
          <div className="relative mb-2">
            <label htmlFor="explorer-search" className="sr-only">جستجوی متن داخل تجربه‌ها</label>
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none" aria-hidden="true">
              <Search className="text-slate-400" size={18} />
            </div>
            <input
              id="explorer-search"
              name="explorer-search"
              type="search"
              value={input}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="مثلاً: کوییز، پروژه، «سخت گیر»..."
              autoComplete="off"
              className="search-input w-full bg-slate-100/60 py-3 pr-12 pl-11 rounded-2xl text-base font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white border border-transparent focus:border-blue-200 transition-all placeholder-slate-400 text-slate-700"
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput('')}
                aria-label="پاک کردن جستجو"
                className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 hover:text-slate-600 focus-visible:outline-none"
              >
                <span className="p-1.5 rounded-full bg-slate-200/70 hover:bg-slate-300/70 transition-colors flex"><X size={14} /></span>
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-bold mb-4">
            جستجو در متن کامل تجربه‌ها انجام می‌شود؛ برای جستجوی عبارت دقیق آن را داخل «» بگذارید.
          </p>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              id="filter-professor-score"
              type="button"
              onClick={() => { setKnownScoreOnly((v) => !v); setVisibleCount(30); }}
              aria-pressed={knownScoreOnly}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                knownScoreOnly ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
              }`}
            >
              {knownScoreOnly && <Check size={13} aria-hidden="true" />}
              فقط امتیاز استاد
            </button>

            <button
              id="filter-student-score"
              type="button"
              onClick={() => { setStudentScoreOnly((v) => !v); setVisibleCount(30); }}
              aria-pressed={studentScoreOnly}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                studentScoreOnly ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
              }`}
            >
              {studentScoreOnly && <Check size={13} aria-hidden="true" />}
              فقط دارای نمره دانشجو
            </button>

            <label className="sr-only" htmlFor="filter-prof">فیلتر استاد</label>
            <select
              id="filter-prof"
              value={profFilter}
              onChange={(e) => { setProfFilter(e.target.value); setVisibleCount(30); }}
              className="bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 px-3 py-2 min-h-[40px] max-w-[45%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <option value="">همه استادان</option>
              {facetOptions.professors.map(([name, count]) => (
                <option key={name} value={normalizePersian(name)}>{name} ({fa(count)})</option>
              ))}
            </select>

            <label className="sr-only" htmlFor="filter-course">فیلتر درس</label>
            <select
              id="filter-course"
              value={courseFilter}
              onChange={(e) => { setCourseFilter(e.target.value); setVisibleCount(30); }}
              className="bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 px-3 py-2 min-h-[40px] max-w-[45%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <option value="">همه دروس</option>
              {facetOptions.courses.map(([name, count]) => (
                <option key={name} value={normalizePersian(name)}>{name} ({fa(count)})</option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 rounded-xl text-[11px] font-bold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-all min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                پاک کردن فیلترها
              </button>
            )}
          </div>

          {/* Keyword discovery (corpus-derived frequency, fixed algorithm) */}
          <div className="mt-4 mb-6">
            <h2 className="text-xs font-black text-slate-600 mb-2">کلیدواژه‌های پرتکرار در تجربه‌ها</h2>
            <p className="text-[10px] font-bold text-slate-400 mb-3 leading-5">
              پرتکرارترین واژه‌های معنادار متن تجربه‌ها؛ با انتخاب هر واژه، نتایج همان واژه نمایش داده می‌شود.
            </p>
            <div className="flex flex-wrap gap-2">
              {keywords.map((k) => (
                <button
                  key={k.token}
                  type="button"
                  onClick={() => { handleSearchInput(k.token); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:border-blue-200 hover:text-blue-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  {k.token} <span className="text-slate-400">{fa(k.count)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {results.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {results.slice(0, visibleCount).map((r) => (
                <ResultCard
                  key={r.item.identity}
                  result={r}
                  entry={entryById.get(r.item.identity)}
                  onOpenExperience={onOpenExperience}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                <Search size={26} aria-hidden="true" />
              </div>
              <p className="font-bold text-slate-600">نتیجه‌ای یافت نشد</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">عبارت دیگری را امتحان کنید یا فیلترها را بردارید.</p>
              <button
                type="button"
                onClick={() => { setInput(''); clearFilters(); }}
                className="px-5 py-2.5 bg-blue-50 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                پاک کردن همه
              </button>
            </div>
          )}

          {results.length > visibleCount && (
            <div className="flex justify-center py-8">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 30)}
                className="px-6 py-3 bg-white border border-slate-200 text-blue-600 text-sm font-bold rounded-2xl shadow-sm hover:border-blue-200 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                نمایش بیشتر ({fa(results.length - visibleCount)} مورد دیگر)
              </button>
            </div>
          )}
        </>
      )}

      {/* Semantic Atlas (corpus-derived, build-time) */}
      <section aria-label="اطلس موضوعی معنایی" className="mt-10">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={15} className="text-indigo-500" aria-hidden="true" />
          <h2 className="text-xs font-black text-slate-600">موضوعات کشف‌شده از متن تجربه‌ها</h2>
        </div>

        {atlasState.status === 'loading' && (
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 bg-white border border-slate-100 rounded-2xl p-4" role="status">
            <span className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" aria-hidden="true" />
            در حال بارگذاری اطلس موضوعی...
          </div>
        )}

        {atlasState.status === 'error' && (
          <p className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-2xl p-4 leading-5">
            اطلس موضوعی در دسترس نیست. جست‌وجوی متنی زیر کاملاً فعال است.
          </p>
        )}

        {atlasState.status === 'ready' && !atlasState.binding.bound && (
          <p className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-2xl p-4 leading-5">
            نسخه‌ی اطلس موضوعی با داده‌های فعلی هم‌خوانی ندارد
            {atlasState.binding.reason === 'dataset-checksum-mismatch' ? ' (داده‌ها به‌روز شده‌اند اما تولید مجددِ اطلس انجام نشده)' : ''}
            . برای جلوگیری از نمایش موضوعات قدیمی، این بخش موقتاً غیرفعال است و جست‌وجوی متنی زیر فعال است.
          </p>
        )}

        {atlasState.status === 'ready' && atlasState.binding.bound && atlasState.binding.mode === 'lexical-fallback' && (
          <p className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-2xl p-4 leading-5">
            در آخرین تولید، خوشه‌بندی معنایی به آستانه‌های کیفیت نرسید؛ به‌جای موضوعاتِ غیرقابل‌اتکا، جست‌وجوی متنی دقیق در دسترس شماست.
          </p>
        )}

        {topicsReady && (
          <>
            <p className="text-[10px] font-bold text-slate-400 mb-3 leading-5 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
              {fa(topicsList.length)} موضوع از خوشه‌بندی خودکار متن {fa(totalDocs)} تجربه ساخته شده (بدون فهرست دستی). برچسب‌ها خودکار و بازبینی‌نشده‌اند؛ هر موضوع را با واژه‌ها و نمونه‌هایش بسنجید.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {topicsList.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  expanded={expandedTopic === topic.id}
                  onToggle={() => setExpandedTopic(expandedTopic === topic.id ? null : topic.id)}
                  onShowExperiences={() => selectTopic(topic)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
