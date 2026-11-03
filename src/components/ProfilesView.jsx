import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight, Star, GraduationCap, BookOpen, Scale, Info,
  SearchX, Users, FileText, ExternalLink, HelpCircle, ListChecks,
} from 'lucide-react';
import { normalizePersian } from '../lib/search.js';
import {
  buildProfiles,
  filterAndSortProfessors,
} from '../lib/profiles.js';
import { professorRoute, courseRoute, coursesListSearchLink } from '../lib/router.js';
import DistributionChart from './DistributionChart.jsx';
import ExperienceCard from './ExperienceCard.jsx';

const MotionDiv = motion.div;

function fa(n, digits = 0) {
  return n.toLocaleString('fa-IR', { maximumFractionDigits: digits });
}

function ScoreStatCard({ title, value, hint, tone = 'slate' }) {
  const tones = {
    amber: 'text-amber-500',
    blue: 'text-blue-600',
    slate: 'text-slate-700',
  };
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 shadow-sm">
      <div className="text-[10px] font-bold text-slate-400 mb-1">{title}</div>
      <div className={`text-lg font-black ${tones[tone]}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-400 font-bold mt-0.5">{hint}</div>}
    </div>
  );
}

function ScoreHelpNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="توضیح نحوه محاسبه امتیازها"
        className="p-1.5 text-slate-400 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-full"
      >
        <HelpCircle size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="note" className="absolute z-20 top-full mt-1 left-0 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-[11px] leading-5 text-slate-600">
          امتیاز استاد میانگین امتیازهایی است که دانشجوها در تجربه‌هایشان ثبت کرده‌اند (مقیاس ۰ تا ۲۰). مقدارهای نامشخص («؟») یا خارج از بازه در محاسبه میانگین وارد نمی‌شوند و فقط شمرده می‌شوند.
          <button type="button" onClick={() => setOpen(false)} className="mt-2 text-blue-600 font-bold block">بستن</button>
        </div>
      )}
    </div>
  );
}

function SampleSizeNote({ stats }) {
  if (stats.validCount === 0) {
    return (
      <p className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
        هیچ امتیاز معتبری برای این بخش ثبت نشده است — تنها تجربه‌های متنی موجودند.
      </p>
    );
  }
  if (stats.validCount < 5) {
    return (
      <p className="text-[11px] font-bold text-amber-600 bg-amber-50/70 border border-amber-100 rounded-xl px-3 py-2">
        این آمار بر اساس تنها {fa(stats.validCount)} امتیاز معتبر است — نمونه کوچک، قضاوت قطعی نیست.
      </p>
    );
  }
  return (
    <p className="text-[11px] font-bold text-slate-400">
      محاسبه‌شده از {fa(stats.validCount)} امتیاز معتبر{stats.validCount < stats.totalCount ? ` (از ${fa(stats.totalCount)} تجربه)` : ''}.
    </p>
  );
}

function DirectoryRow({ profile, type }) {
  const { professorStats } = profile;
  const sub = type === 'professor'
    ? profile.courses.slice(0, 3).map((c) => c.name).join('، ')
    : profile.professors.slice(0, 3).map((p) => p.name).join('، ');
  const href = type === 'professor' ? professorRoute(profile.key) : courseRoute(profile.key);
  return (
    <a
      href={href}
      className="group block bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:border-blue-100 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-extrabold text-slate-800 group-hover:text-blue-600 transition-colors truncate overflow-wrap-anywhere">
            {type === 'professor' ? profile.name : profile.name}
          </h3>
          <p className="text-[11px] text-slate-400 font-bold mt-1 truncate">{sub}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-100/60 px-2 py-1 rounded-lg whitespace-nowrap">
            {fa(profile.totalCount)} تجربه
          </span>
          {type === 'professor' && professorStats.avg != null && (
            <span
              className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-100/60 px-2 py-1 rounded-lg whitespace-nowrap"
              title={
                professorStats.validCount < 5
                  ? 'این میانگین بر اساس کمتر از ۵ امتیاز معتبر است و نمونه محدودی دارد.'
                  : `میانگین بر اساس ${fa(professorStats.validCount)} امتیاز معتبر محاسبه شده است.`
              }
            >
              ★ {fa(professorStats.avg, 1)}
              <span className="text-slate-400 font-bold">
                {' '}({fa(professorStats.validCount)})
              </span>

              {professorStats.validCount < 5 && (
                <span className="block text-amber-700 font-extrabold mt-0.5">
                  نمونه محدود
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

function Directory({ profiles, type }) {
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [ratedOnly, setRatedOnly] = useState(false);
  const [minSample, setMinSample] = useState('0');
  const [sortBy, setSortBy] = useState('experience');

  const isProfessorDirectory = type === 'professor';

  // Collect unique course options from the professor profiles.
  const courseOptions = useMemo(() => {
    if (!isProfessorDirectory) return [];

    const map = new Map();

    for (const profile of profiles) {
      for (const course of profile.courses) {
        if (!map.has(course.key)) {
          map.set(course.key, {
            key: course.key,
            name: course.name,
          });
        }
      }
    }

    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'fa')
    );
  }, [profiles, isProfessorDirectory]);

  const filtered = useMemo(() => {
    if (isProfessorDirectory) {
      return filterAndSortProfessors(profiles, {
        query,
        courseKey: courseFilter,
        ratedOnly,
        minValidScores: Number(minSample),
        sortBy,
      });
    }

    const normalizedQuery = normalizePersian(query);

    return profiles.filter((profile) => {
      if (!normalizedQuery) return true;

      return normalizePersian(profile.name).includes(normalizedQuery);
    });
  }, [
    profiles,
    type,
    isProfessorDirectory,
    query,
    courseFilter,
    ratedOnly,
    minSample,
    sortBy,
  ]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    courseFilter !== '' ||
    ratedOnly ||
    minSample !== '0' ||
    sortBy !== 'experience';

  function clearDirectoryFilters() {
    setQuery('');
    setCourseFilter('');
    setRatedOnly(false);
    setMinSample('0');
    setSortBy('experience');
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-black text-slate-800">
          {isProfessorDirectory ? 'دایرکتوری استادان' : 'دایرکتوری دروس'}
        </h1>

        <span
          className="text-xs font-bold text-slate-500 bg-slate-200/50 px-3 py-1 rounded-full"
          aria-hidden="true"
        >
          {fa(filtered.length)} {isProfessorDirectory ? 'استاد' : 'درس'}
        </span>

        <p role="status" className="sr-only" aria-live="polite">
          {fa(filtered.length)} مورد
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <label htmlFor="directory-search" className="sr-only">
          {isProfessorDirectory
            ? 'جستجوی استاد یا درس‌های مرتبط'
            : 'جستجوی نام درس'}
        </label>

        <input
          id="directory-search"
          name="directory-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            isProfessorDirectory
              ? 'جستجوی نام استاد یا نام درس...'
              : 'جستجوی نام درس...'
          }
          className="search-input w-full bg-slate-100/60 py-3 px-4 rounded-2xl text-base font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white border border-transparent focus:border-blue-200 transition-all placeholder-slate-400 text-slate-700"
        />
      </div>

      {/* Professor-only filters */}
      {isProfessorDirectory && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-4">
          <label className="sr-only" htmlFor="directory-course-filter">
            فیلتر بر اساس درس
          </label>

          <select
            id="directory-course-filter"
            value={courseFilter}
            onChange={(event) => setCourseFilter(event.target.value)}
            className="w-full sm:w-auto sm:min-w-48 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 px-3 py-2.5 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <option value="">همه درس‌ها</option>

            {courseOptions.map((course) => (
              <option key={course.key} value={course.key}>
                {course.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="directory-min-sample">
            حداقل تعداد امتیاز معتبر
          </label>

          <select
            id="directory-min-sample"
            value={minSample}
            onChange={(event) => setMinSample(event.target.value)}
            className="w-full sm:w-auto bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 px-3 py-2.5 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <option value="0">هر تعداد امتیاز معتبر</option>
            <option value="5">حداقل ۵ امتیاز معتبر</option>
            <option value="10">حداقل ۱۰ امتیاز معتبر</option>
          </select>

          <label className="sr-only" htmlFor="directory-sort">
            ترتیب نمایش استادان
          </label>

          <select
            id="directory-sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="w-full sm:w-auto bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 px-3 py-2.5 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <option value="experience">بیشترین تجربه</option>
            <option value="score-high">میانگین امتیاز بالاتر</option>
            <option value="score-low">میانگین امتیاز پایین‌تر</option>
            <option value="score-count">بیشترین تعداد امتیاز معتبر</option>
            <option value="name">ترتیب الفبایی</option>
          </select>

          <button
            id="directory-rated-only"
            type="button"
            onClick={() => setRatedOnly((value) => !value)}
            aria-pressed={ratedOnly}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
              ratedOnly
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
            }`}
          >
            {ratedOnly ? '✓ ' : ''}
            فقط استادان امتیازدار
          </button>

          {hasActiveFilters && (
            <button
              id="directory-clear-filters"
              type="button"
              onClick={clearDirectoryFilters}
              className="w-full sm:w-auto px-3 py-2.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
            >
              پاک کردن جست‌وجو و فیلترها
            </button>
          )}
        </div>
      )}

      {isProfessorDirectory &&
        (sortBy === 'score-high' || sortBy === 'score-low') && (
          <p className="text-[11px] text-slate-500 font-bold mb-4 leading-5">
            در مرتب‌سازی میانگین، استادانی که حداقل ۵ امتیاز معتبر دارند
            در اولویت نمایش‌اند. میانگین‌های مبتنی بر نمونه کوچک در بخش بعدی
            قرار می‌گیرند و به‌تنهایی مبنای قضاوت نیستند.
          </p>
        )}

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((profile) => (
            <DirectoryRow
              key={profile.key}
              profile={profile}
              type={type}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
            <SearchX size={26} aria-hidden="true" />
          </div>

          <p className="font-bold text-slate-600">
            موردی یافت نشد
          </p>

          <p className="text-xs text-slate-400 mt-1 mb-4">
            جست‌وجو یا فیلترهای انتخاب‌شده را تغییر بده.
          </p>

          {isProfessorDirectory && hasActiveFilters && (
            <button
              type="button"
              onClick={clearDirectoryFilters}
              className="px-5 py-2.5 bg-blue-50 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              پاک کردن همه فیلترها
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonPanel({ course, selectedKeys }) {
  const chosen = course.professors.filter((p) => selectedKeys.includes(p.key));
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Scale size={16} className="text-indigo-500" aria-hidden="true" />
        <h3 className="text-sm font-black text-slate-800">مقایسه بر اساس تجربه‌های دانشجوها</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {chosen.map((p) => {
          // Rebuild the professor's records *within this course* only — a fair,
          // like-for-like comparison inside the same course.
          const records = course.records.filter((r) => r._professorNorm === p.key);
          const profScores = records.map((r) => r._professorScore).filter((v) => v != null);
          const stats = {
            validCount: profScores.length,
            avg: profScores.length ? profScores.reduce((a, b) => a + b, 0) / profScores.length : null,
            median: profScores.length ? [...profScores].sort((a, b) => a - b)[Math.floor((profScores.length - 1) / 2)] : null,
            distribution: null,
          };
          // distribution over the same 5 bins
          const distribution = [0, 0, 0, 0, 0];
          for (const v of profScores) {
            const bin = Math.min(4, Math.floor(v / 4.0001));
            distribution[bin] += 1;
          }
          return (
            <div key={p.key} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-3">
                <a href={professorRoute(p.key)} className="text-sm font-extrabold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded overflow-wrap-anywhere">
                  {p.name}
                </a>
                <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-lg whitespace-nowrap">
                  {fa(records.length)} تجربه
                </span>
              </div>
              {stats.avg != null ? (
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="text-2xl font-black text-amber-500">★ {fa(stats.avg, 1)}</span>
                  <span className="text-[11px] font-bold text-slate-400">میانه {fa(stats.median, 1)} · {fa(stats.validCount)} امتیاز معتبر</span>
                </div>
              ) : (
                <p className="text-[11px] font-bold text-slate-400 mb-3">امتیاز معتبری ثبت نشده — مقایسه عددی ممکن نیست.</p>
              )}
              <DistributionChart distribution={distribution} tone="amber" label={`توزیع امتیاز استاد ${p.name} در درس ${course.name}`} />
              <SampleSizeNote stats={stats} />
            </div>
          );
        })}
      </div>
      <p className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 mt-4 leading-5">
        توجه: این مقایسه فقط تفاوت تجربه‌های ثبت‌شده را نشان می‌دهد. نمونه‌های کوچک (چند تجربه در برابر ده‌ها تجربه) بازنمایی قابل اتکایی از کیفیت تدریس نیستند و هیچ نتیجه‌گیری رسمی‌ای بیان نمی‌شود.
      </p>
    </div>
  );
}

function ProfilePage({ profile, type, onOpenExperience }) {
  const [selectedForCompare, setSelectedForCompare] = useState([]);
  const isProfessor = type === 'professor';
  const stats = profile.professorStats;

  const toggleCompare = (key) => {
    setSelectedForCompare((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].slice(-3)
    );
  };

  return (
    <div>
      <a href={isProfessor ? '#/professors' : '#/courses'} className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded px-1">
        <ArrowRight size={14} aria-hidden="true" />
        {isProfessor ? 'بازگشت به دایرکتوری استادان' : 'بازگشت به دایرکتوری دروس'}
      </a>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-xl font-black text-slate-800 overflow-wrap-anywhere">{profile.name}</h1>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black text-blue-700 bg-blue-50 border border-blue-100/60 px-2.5 py-1.5 rounded-lg">
            {fa(profile.totalCount)} تجربه
          </span>
          <span className="text-[11px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100/60 px-2.5 py-1.5 rounded-lg">
            {isProfessor ? `${fa(profile.courses.length)} درس` : `${fa(profile.professors.length)} استاد`}
          </span>
          <ScoreHelpNote />
        </div>
      </div>

      {profile.rawVariants.length > 1 && (
        <p className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 mb-4">
          این نام با {fa(profile.rawVariants.length)} املای متفاوت در تجربه‌ها ثبت شده است؛ همه به یک پروفایل تعلق دارند و املای رایج‌تر نمایش داده می‌شود.
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
        <ScoreStatCard title="میانگین امتیاز استاد" value={stats.avg != null ? `★ ${fa(stats.avg, 1)}` : '—'} tone="amber" />
        <ScoreStatCard title="میانه" value={stats.median != null ? fa(stats.median, 1) : '—'} />
        <ScoreStatCard title="بازه" value={stats.min != null ? `${fa(stats.min, 1)}–${fa(stats.max, 1)}` : '—'} />
        <ScoreStatCard title="معتبر / نامشخص" value={`${fa(stats.validCount)} / ${fa(profile.totalCount - stats.validCount)}`} tone="blue" />
      </div>
      <div className="mb-4 flex justify-end"><SampleSizeNote stats={stats} /></div>

      {/* Distribution */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm mb-6">
        <h2 className="text-xs font-black text-slate-600 mb-3">توزیع امتیاز استاد (۰ تا ۲۰)</h2>
        <DistributionChart distribution={stats.distribution} tone="amber" label={`توزیع امتیاز ${profile.name}`} />
      </div>

      {/* For courses: student score stats + comparison + CoursesList link */}
      {!isProfessor && (
        <>
          {profile.studentStats.validCount > 0 && (
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm mb-6">
              <h2 className="text-xs font-black text-slate-600 mb-3">توزیع نمره‌ای که دانشجوها گرفته‌اند (۰ تا ۲۰)</h2>
              <DistributionChart distribution={profile.studentStats.distribution} tone="blue" label={`توزیع نمره دانشجوها در ${profile.name}`} />
              <SampleSizeNote stats={profile.studentStats} />
            </div>
          )}

          {profile.professors.length >= 2 && (
            <div className="bg-slate-50/80 border border-slate-100 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <ListChecks size={16} className="text-indigo-500" aria-hidden="true" />
                <h2 className="text-xs font-black text-slate-600">انتخاب برای مقایسه (حداکثر ۳ استاد)</h2>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {profile.professors.map((p) => {
                  const checked = selectedForCompare.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => toggleCompare(p.key)}
                      aria-pressed={checked}
                      className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition-all min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 overflow-wrap-anywhere ${
                        checked
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      {p.name} <span className={checked ? 'text-indigo-200' : 'text-slate-400'}>({fa(p.count)})</span>
                    </button>
                  );
                })}
              </div>
              {selectedForCompare.length >= 2 && (
                <ComparisonPanel course={profile} selectedKeys={selectedForCompare} />
              )}
            </div>
          )}

          <a
            href={coursesListSearchLink(profile.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs font-bold text-cyan-700 bg-cyan-50/70 border border-cyan-100 px-4 py-2.5 rounded-xl mb-6 hover:bg-cyan-100/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
          >
            <ExternalLink size={14} aria-hidden="true" />
            جستجوی «{profile.name}» در لیست دروس (برنامه‌ریزی ترم)
          </a>
        </>
      )}

      {/* Cross links */}
      <div className="mb-6">
        <h2 className="text-xs font-black text-slate-600 mb-2">{isProfessor ? 'درس‌های این استاد' : 'استادان این درس'}</h2>
        <div className="flex flex-wrap gap-2">
          {(isProfessor ? profile.courses : profile.professors).map((x) => (
            <a
              key={x.key}
              href={isProfessor ? courseRoute(x.key) : professorRoute(x.key)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:border-blue-200 hover:text-blue-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 overflow-wrap-anywhere"
            >
              {x.name} <span className="text-slate-400">({fa(x.count)})</span>
            </a>
          ))}
        </div>
      </div>

      {/* Experiences */}
      <div className="flex items-center gap-2 mb-3">
        <FileText size={15} className="text-slate-400" aria-hidden="true" />
        <h2 className="text-xs font-black text-slate-600">تجربه‌های {isProfessor ? 'این استاد' : 'این درس'} ({fa(profile.records.length)})</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {profile.records.map((item) => (
          <ExperienceCard key={item.identity} item={item} onOpen={() => onOpenExperience(item)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Profiles section root. Renders the directory or a profile page based on the
 * current route. Unknown profile keys get an honest not-found state.
 * Profiles are aggregated here (inside the lazy chunk) so users who never
 * open the section never pay the build cost (mission §9.5).
 */
export default function ProfilesView({ route, searchable, onOpenExperience }) {
  const profiles = useMemo(() => buildProfiles(searchable), [searchable]);
  const section = route.name === 'course' || route.name === 'courses' ? 'courses' : 'professors';

  if (route.name === 'professor') {
    // Deep links may carry raw display names (with ZWNJ/Arabic forms) —
    // normalize before lookup so spelling variants resolve to the same
    // profile (Phase III matrix finding).
    const profile = profiles.professorByKey.get(normalizePersian(route.key));
    if (!profile) return <NotFound type="professor" />;
    return <ProfilePage profile={profile} type="professor" onOpenExperience={onOpenExperience} />;
  }
  if (route.name === 'course') {
    const profile = profiles.courseByKey.get(normalizePersian(route.key));
    if (!profile) return <NotFound type="course" />;
    return <ProfilePage profile={profile} type="course" onOpenExperience={onOpenExperience} />;
  }
  return (
    <Directory
      key={section}
      profiles={section === 'courses' ? profiles.courses : profiles.professors}
      type={section === 'courses' ? 'course' : 'professor'}
    />
  );
}

function NotFound({ type }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
        <SearchX size={26} aria-hidden="true" />
      </div>
      <p className="font-bold text-slate-600">این پروفایل یافت نشد</p>
      <p className="text-xs text-slate-400 mt-1 mb-4">ممکن است نشانی قدیمی یا نادرست باشد.</p>
      <a href={type === 'professor' ? '#/professors' : '#/courses'} className="px-5 py-2.5 bg-blue-50 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
        بازگشت به دایرکتوری
      </a>
    </div>
  );
}
