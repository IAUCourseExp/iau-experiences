import React, { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Capitalized proxy so ESLint's no-unused-vars sees the JSX usage
// (core rule does not count `<motion.div />` member-expression objects).
const MotionDiv = motion.div;
import {
  Menu, X, MessageSquare, Users, BookOpen, Cpu, Calendar,
  SearchX, Dices,
} from 'lucide-react';
import lastUpdateData from './last_update.json';
import { filterAndSort, toSearchable } from './lib/search.js';
import { validateDataset, finishDatasetFingerprint } from './lib/schema.js';
import { useRoute, experienceRoute } from './lib/router.js';

/** Async SHA-256 dataset fingerprint (provenance-grade, Phase IV §8.3). */
function useDatasetFingerprint(validation) {
  const [fingerprint, setFingerprint] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const fp = validation ? await finishDatasetFingerprint(validation) : null;
      if (alive) setFingerprint(fp);
    })();
    return () => { alive = false; };
  }, [validation]);
  return fingerprint;
}
import ViewTabs from './components/ViewTabs.jsx';
import SearchField from './components/SearchField.jsx';
import ExperienceCard from './components/ExperienceCard.jsx';
import DetailsDialog from './components/DetailsDialog.jsx';

// Heavy feature views are code-split so they never burden first paint (§10).
const ProfilesView = lazy(() => import('./components/ProfilesView.jsx'));
const ExplorerView = lazy(() => import('./components/ExplorerView.jsx'));

const PAGE_SIZE = 12;
const SORT_STORAGE_KEY = 'iau-exp-sort';
const RECENT_STORAGE_KEY = 'iau-exp-recent';
const RECENT_LIMIT = 12;

const NAV_LINKS = [
  { href: 'https://t.me/IAUCourseExp', label: 'کانال تجربیات', icon: MessageSquare, tone: 'text-blue-500', hover: 'hover:text-blue-600' },
  { href: 'https://t.me/IAUCourseExpGroup', label: 'گروه تجربیات', icon: Users, tone: 'text-blue-500', hover: 'hover:text-blue-600' },
  { href: 'https://t.me/jozveiau', label: 'کانال جزوه', icon: BookOpen, tone: 'text-indigo-500', hover: 'hover:text-indigo-600' },
  { href: 'https://t.me/computeriaushz', label: 'دیسکاشن کامپیوتر', icon: Cpu, tone: 'text-cyan-500', hover: 'hover:text-cyan-600' },
];

const SORT_OPTIONS = [
  { key: 'newest', label: 'جدیدترین' },
  { key: 'score', label: 'بالاترین امتیاز' },
];

function readStoredSort() {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) === 'score' ? 'score' : 'newest';
  } catch {
    return 'newest';
  }
}

function persistSort(sort) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    /* private mode etc. — preference just won't persist */
  }
}

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    // identities are strings (numeric source ids or synthetic Phase IV ids)
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n.length > 0 && n.length <= 64).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function pushRecent(id) {
  const next = [id, ...readRecent().filter((n) => n !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* unavailable storage */
  }
  return next;
}

function clearRecent() {
  try {
    localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    /* unavailable storage */
  }
  return [];
}

function ViewSpinner() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
      <span className="sr-only">در حال بارگذاری بخش...</span>
      <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" aria-hidden="true" />
    </div>
  );
}

export default function App() {
  // ---- Data (code-split: the 1.97 MB dataset no longer blocks first paint) ----
  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setDataError(false);
    import('./data.json')
      .then((mod) => { if (alive) setData(Array.isArray(mod.default) ? mod.default : []); })
      .catch(() => { if (alive) setDataError(true); });
    return () => { alive = false; };
  }, [reloadNonce]);

  // ---- Routing ----
  const route = useRoute();

  // ---- UI state ----
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState(readStoredSort);
  const [selectedExp, setSelectedExp] = useState(null);
  const [experienceNotFound, setExperienceNotFound] = useState(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [recentIds, setRecentIds] = useState(readRecent);
  const loadMoreTimer = useRef(null);
  const observerTargetRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const pushedExperienceRef = useRef(false);

  const lastUpdate = (lastUpdateData && lastUpdateData.last_update) || '';

  // ---- Derived data (single pass over the dataset; built once per load) ----
  // Phase IV core principle: EVERY source record maps to exactly one classic
  // directory view-model; per-feature eligibility is separate (§7).
  // Profiles and the full-text index are built lazily inside their own
  // code-split views — not here.
  const datasetValidation = useMemo(
    () => (data ? validateDataset(data) : null),
    [data]
  );
  const searchableData = useMemo(
    () => (datasetValidation ? datasetValidation.records.map(toSearchable) : []),
    [datasetValidation]
  );
  // Dataset fingerprint computed for artifact binding verification
  useDatasetFingerprint(datasetValidation);
  const recordById = useMemo(() => {
    const map = new Map();
    for (const r of searchableData) {
      if (!map.has(r.identity)) map.set(r.identity, r); // duplicates keep first occurrence; both remain visible
    }
    return map;
  }, [searchableData]);

  const filteredData = useMemo(
    () => filterAndSort(searchableData, searchTerm, sortMode),
    [searchableData, searchTerm, sortMode]
  );

  const visibleData = useMemo(
    () => filteredData.slice(0, displayCount),
    [filteredData, displayCount]
  );

  const hasMore = displayCount < filteredData.length;

  function handleSearchChange(value) {
    if (loadMoreTimer.current) {
      clearTimeout(loadMoreTimer.current);
      loadMoreTimer.current = null;
    }
    setSearchTerm(value);
    setDisplayCount(PAGE_SIZE);
  }

  function handleSortChange(mode) {
    setSortMode(mode);
    persistSort(mode);
    setDisplayCount(PAGE_SIZE);
  }

  // ---- Progressive loading: IntersectionObserver + explicit fallback button ----
  useEffect(() => {
    const target = observerTargetRef.current;
    if (!target || !hasMore) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined; // button still works
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (loadMoreTimer.current) clearTimeout(loadMoreTimer.current);
          loadMoreTimer.current = setTimeout(() => {
            setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, filteredData.length));
          }, 120);
        }
      },
      { rootMargin: '240px 0px' }
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      if (loadMoreTimer.current) {
        clearTimeout(loadMoreTimer.current);
        loadMoreTimer.current = null;
      }
    };
  }, [hasMore, filteredData.length]);

  // ---- Mobile menu: outside click + Escape close ----
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    function onPointerDown(e) {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        menuButtonRef.current && !menuButtonRef.current.contains(e.target)
      ) {
        setIsMenuOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
        if (menuButtonRef.current) menuButtonRef.current.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMenuOpen]);

  // ---- Experience dialog ↔ deep-link route sync ----
  useEffect(() => {
    if (route.name === 'experience') {
      const record = recordById.get(route.id);
      if (record) {
        setExperienceNotFound(null);
        setSelectedExp(record);
        setRecentIds(pushRecent(record.identity));
      } else if (data) {
        // Invalid or missing id: honest state, never a blank screen
        setSelectedExp(null);
        setExperienceNotFound(route.id);
      }
    } else {
      setSelectedExp(null);
      setExperienceNotFound(null);
    }
  }, [route.name, route.id, recordById, data]);

  const openExperience = useCallback((item) => {
    pushedExperienceRef.current = true;
    window.location.hash = experienceRoute(item.identity);
  }, []);

  const closeExperience = useCallback(() => {
    if (pushedExperienceRef.current) {
      pushedExperienceRef.current = false;
      window.history.back();
    } else {
      // deep link opened directly — replace so Back leaves the site naturally
      window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
      window.dispatchEvent(new Event('hashchange'));
    }
  }, []);

  // Scroll to top on real section changes (not on dialog open/close)
  useEffect(() => {
    if (route.name !== 'experience') {
      window.scrollTo({ top: 0 });
    }
  }, [route.name, route.key]);

  const section =
    route.name === 'browse' || route.name === 'experience'
      ? 'browse'
      : route.name === 'explore'
        ? 'explore'
        : 'profiles';

  const clearSearch = useCallback(() => handleSearchChange(''), []);

  const searching = searchTerm.trim().length > 0;
  const resultCount = filteredData.length;

  // Related experiences for the dialog (same professor / same course)
  const related = useMemo(() => {
    if (!selectedExp) return null;
    const sameProfessor = searchableData.filter(
      (r) => r.id !== selectedExp.id && r.professor.trim() && r._professorNorm === selectedExp._professorNorm
    );
    const sameCourse = searchableData.filter(
      (r) => r.id !== selectedExp.id && r.course.trim() && r._courseNorm === selectedExp._courseNorm && r._professorNorm !== selectedExp._professorNorm
    );
    return { sameProfessor, sameCourse };
  }, [selectedExp, searchableData]);

  const recentItems = useMemo(
    () => recentIds.map((id) => recordById.get(id)).filter(Boolean),
    [recentIds, recordById]
  );

  function handleRandomExperience() {
    const pool = filteredData.length > 0 ? filteredData : searchableData;
    if (pool.length === 0) return;
    // Picks which public review to display — not a security-sensitive choice.
    // crypto.getRandomValues is available in all supported browsers.
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    openExperience(pool[buf[0] % pool.length]);
  }

  const browsing = route.name === 'browse' || route.name === 'experience';

  return (
    <div className="min-h-screen flex flex-col font-sans text-right bg-[#f4f7fb]">
      {/* Navigation Bar */}
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-200/60 shadow-sm transition-all duration-300" aria-label="ناوبری اصلی">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col justify-center">
          <div className="flex items-center justify-between w-full gap-3 min-w-0">
            {/* Logo & Title */}
            <a href="#/" className="flex items-center gap-3 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-xl">
              <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 overflow-hidden rounded-xl shadow-md shadow-blue-100 border border-slate-50 bg-white p-0.5">
                <img src="./logo.png" alt="" width="96" height="96" className="w-full h-full object-cover rounded-lg" />
              </div>
              <div className="flex flex-col">
                <span className="text-slate-900 font-black text-lg leading-none tracking-tight">تجربیات</span>
                <span className="text-[10px] text-blue-700 font-extrabold uppercase tracking-widest mt-1">IAU of Shiraz<span className="sr-only"> — صفحه اصلی</span></span>
              </div>
            </a>

            {/* Desktop search — browse view only */}
            {browsing && (
              <SearchField
                id="search-desktop"
                value={searchTerm}
                onChange={handleSearchChange}
                className="hidden xl:block relative flex-1 max-w-sm mx-4 min-w-0"
              />
            )}

            {/* External links (≥ xl) */}
            <div className="hidden xl:flex items-center gap-3 shrink-0">
              <div className="flex gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                {NAV_LINKS.slice(0, 2).map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 ${link.hover} bg-transparent hover:bg-white rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40`}>
                    <link.icon size={14} className={link.tone} aria-hidden="true" /> {link.label}
                  </a>
                ))}
              </div>
              <div className="flex gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                {NAV_LINKS.slice(2).map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 ${link.hover} bg-transparent hover:bg-white rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40`}>
                    <link.icon size={14} className={link.tone} aria-hidden="true" /> {link.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Menu toggle (below xl) */}
            <div className="xl:hidden shrink-0">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setIsMenuOpen((open) => !open)}
                aria-expanded={isMenuOpen}
                aria-controls="mobile-menu"
                aria-label={isMenuOpen ? 'بستن منو' : 'باز کردن منو'}
                className="p-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                {isMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {/* Section tabs */}
          <ViewTabs section={section} />

          {/* Always-visible Tehran update time, aligned to the left edge */}
          <div
            className="w-full mt-2 flex justify-start"
            dir="ltr"
          >
            <div className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-50/70 border border-emerald-100/70 rounded-xl">
              <Calendar
                size={14}
                className="text-emerald-600 shrink-0"
                aria-hidden="true"
              />

              <span
                dir="rtl"
                className="text-[10px] text-emerald-700 font-bold"
              >
                آخرین بروزرسانی:
              </span>

              <time
                id="last-update"
                dir="ltr"
                className="text-[11px] text-emerald-800 font-black tabular-nums"
              >
                {lastUpdate || 'نامشخص'}
              </time>

              <span
                dir="rtl"
                className="text-[10px] text-emerald-700 font-bold"
              >
                به وقت تهران
              </span>
            </div>
          </div>

          {/* Mobile search — browse view only */}
          {browsing && (
            <SearchField
              id="search-mobile"
              value={searchTerm}
              onChange={handleSearchChange}
              className="xl:hidden mt-3 relative w-full"
            />
          )}

          {/* Expanded menu (below xl) */}
          <AnimatePresence>
            {isMenuOpen && (
              <MotionDiv
                id="mobile-menu"
                ref={menuRef}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="xl:hidden overflow-hidden mt-3 flex flex-col gap-2 pt-3 border-t border-slate-100/80"
              >
                <div className="grid grid-cols-2 gap-2">
                  {NAV_LINKS.map((link) => (
                    <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                      onClick={() => setIsMenuOpen(false)}
                      className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl text-xs font-bold text-slate-700 hover:bg-blue-50 active:bg-blue-100/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                      <link.icon size={16} className={link.tone} aria-hidden="true" /> {link.label}
                    </a>
                  ))}
                </div>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-12 w-full">
        {dataError ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400" role="alert">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <SearchX size={32} className="text-slate-400" aria-hidden="true" />
            </div>
            <p className="font-bold text-lg text-slate-600">مشکلی در بارگذاری تجربه‌ها پیش آمد</p>
            <p className="text-sm text-slate-400 mt-1 mb-4">لطفاً دوباره تلاش کنید.</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              تلاش مجدد
            </button>
          </div>
        ) : !data ? (
          <div role="status" aria-live="polite" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 md:gap-6">
            <span className="sr-only">در حال بارگذاری تجربه‌ها...</span>
            {Array.from({ length: PAGE_SIZE }, (_, i) => (
              <div key={i} className="bg-white rounded-[1.5rem] p-5 md:p-6 border border-slate-100 animate-pulse motion-reduce:animate-none" aria-hidden="true">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-5 w-2/3 bg-slate-100 rounded-lg" />
                  <div className="h-8 w-10 bg-amber-50 rounded-lg" />
                </div>
                <div className="space-y-2.5">
                  <div className="h-3.5 bg-slate-100 rounded-md" />
                  <div className="h-3.5 bg-slate-100 rounded-md w-11/12" />
                  <div className="h-3.5 bg-slate-100 rounded-md w-4/5" />
                </div>
                <div className="mt-6 pt-4 border-t border-slate-100/80 flex justify-between">
                  <div className="h-5 w-16 bg-slate-100 rounded-md" />
                  <div className="h-5 w-14 bg-slate-100 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : browsing ? (
          <>
            {/* Status header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5 px-1">
              <div className="flex items-center gap-3 min-w-0">
                <h1 className="text-lg md:text-xl font-black text-slate-800">
                  {searching ? 'نتایج جستجو' : 'آخرین تجارب'}
                </h1>
                <span className="text-xs font-bold text-slate-600 bg-slate-200/50 px-3 py-1 rounded-full" aria-hidden="true">
                  {resultCount.toLocaleString('fa-IR')} مورد
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRandomExperience}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-200 rounded-xl text-[11px] font-bold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  title="نمایش یک تجربه تصادفی از همین فهرست"
                >
                  <Dices size={15} aria-hidden="true" />
                  یه تجربه شانسی
                </button>
                <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60" role="group" aria-label="ترتیب نمایش">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => handleSortChange(option.key)}
                      aria-pressed={sortMode === option.key}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                        sortMode === option.key
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {data && (
              <p role="status" className="sr-only">
                {searching
                  ? `${resultCount.toLocaleString('fa-IR')} نتیجه برای جستجو پیدا شد`
                  : `${resultCount.toLocaleString('fa-IR')} تجربه موجود است`}
              </p>
            )}

            {/* Recently viewed (Phase II) */}
            {recentItems.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[11px] font-black text-slate-600">بازدیدهای اخیر</h2>
                  <button
                    type="button"
                    onClick={() => setRecentIds(clearRecent())}
                    className="text-[10px] font-bold text-slate-600 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 rounded px-1"
                  >
                    پاک کردن تاریخچه
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {recentItems.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openExperience(r)}
                      className="shrink-0 max-w-[220px] text-right px-3 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:border-blue-200 hover:text-blue-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                      <span className="truncate block overflow-wrap-anywhere">
                        {r.professor.trim() || 'بدون نام'}{r.course.trim() ? ` — ${r.course.trim()}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visibleData.length > 0 ? (
              <AnimatePresence mode="popLayout">
                <div key={searching ? 'search' : 'all'} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 md:gap-6 auto-rows-fr">
                  {visibleData.map((item) => (
                    <ExperienceCard key={item.identity} item={item} onOpen={() => openExperience(item)} />
                  ))}
                </div>
              </AnimatePresence>
            ) : (
              <div className="flex flex-col items-center justify-center py-32 text-slate-400">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <SearchX size={32} className="text-slate-400" aria-hidden="true" />
                </div>
                <p className="font-bold text-lg text-slate-600">موردی یافت نشد</p>
                <p className="text-sm text-slate-400 mt-1 mb-5">لطفاً کلمات دیگری را امتحان کنید.</p>
                {searching && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="px-5 py-2.5 bg-blue-50 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  >
                    پاک کردن جستجو
                  </button>
                )}
              </div>
            )}

            {/* Progressive loading controls */}
            {hasMore && (
              <div ref={observerTargetRef} className="w-full flex flex-col items-center justify-center py-10">
                <button
                  type="button"
                  onClick={() => setDisplayCount((prev) => Math.min(prev + PAGE_SIZE * 2, filteredData.length))}
                  className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-blue-600 text-sm font-bold rounded-2xl shadow-sm hover:border-blue-200 hover:shadow-md transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  نمایش بیشتر
                </button>
                <span className="mt-3 text-[11px] font-bold text-slate-600">در حال نمایش {visibleData.length.toLocaleString('fa-IR')} از {resultCount.toLocaleString('fa-IR')} مورد</span>
              </div>
            )}
            {!hasMore && resultCount > 0 && (
              <div className="w-full flex justify-center py-10">
                <span className="text-[11px] font-bold text-slate-500 tracking-widest bg-slate-100 px-4 py-2 rounded-full">
                  پایان لیست
                </span>
              </div>
            )}
          </>
        ) : (
          <Suspense fallback={<ViewSpinner />}>
            {route.name === 'explore' ? (
              <ExplorerView
                searchable={searchableData}
                datasetChecksum={datasetValidation?.driftFingerprint ?? null}
                onOpenExperience={openExperience}
              />
            ) : (
              <ProfilesView
                route={route}
                searchable={searchableData}
                onOpenExperience={openExperience}
              />
            )}
          </Suspense>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full py-6 bg-white border-t border-slate-100 text-center mt-auto">
        <div className="text-red-700 font-bold text-sm md:text-base">
          طراحی شده برای دانشجویان آزاد شیراز
        </div>
      </footer>

      {/* Details dialog (deep-linkable via #/experience/<id>) */}
      <AnimatePresence>
        {selectedExp && (
          <DetailsDialog
            exp={selectedExp}
            related={related}
            onOpenExperience={openExperience}
            recordById={recordById}
            datasetChecksum={datasetValidation?.driftFingerprint ?? null}
            onClose={closeExperience}
          />
        )}
        {experienceNotFound != null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[4px]" aria-hidden="true" onClick={closeExperience} />
            <div role="alertdialog" aria-modal="true" aria-label="تجربه یافت نشد" className="relative z-10 bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
              <SearchX size={30} className="text-slate-300 mx-auto mb-3" aria-hidden="true" />
              <h2 className="text-base font-black text-slate-800 mb-1">این تجربه یافت نشد</h2>
              <p className="text-xs text-slate-500 leading-6 mb-4">
                نشانی به تجربه‌ای با شناسه {String(experienceNotFound)} اشاره دارد که در داده‌های فعلی وجود ندارد.
              </p>
              <button
                type="button"
                onClick={closeExperience}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                بازگشت به تجربه‌ها
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
