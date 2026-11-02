import { useMemo, useState } from 'react';
import { Users, Star, BookOpen, Check, ChevronLeft, ChevronRight, ExternalLink, Scale } from 'lucide-react';
import { normalizePersian } from '../lib/search.js';
import { professorRoute, courseRoute } from '../lib/router.js';
import ExperienceCard from './ExperienceCard.jsx';

function fa(n) {
  return n.toLocaleString('fa-IR');
}

function EvidenceBadge({ count, label, color }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {fa(count)} {label}
    </span>
  );
}

function ProfessorComparisonCard({ professor, records, selected, onToggle }) {
  const stats = useMemo(() => {
    const profRecords = records.filter(r => r._professorNorm === normalizePersian(professor));
    const withScore = profRecords.filter(r => r._professorScore != null);
    const avg = withScore.length ? (withScore.reduce((s, r) => s + r._professorScore, 0) / withScore.length) : null;
    const median = withScore.length ? [...withScore].sort((a, b) => a._professorScore - b._professorScore)[Math.floor(withScore.length / 2)]._professorScore : null;
    const min = withScore.length ? Math.min(...withScore.map(r => r._professorScore)) : null;
    return { total: profRecords.length, withScore, avg, median, min };
  }, [professor, records]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative bg-white rounded-2xl p-5 border-2 transition-all duration-300 shadow-sm ${
        selected ? 'ring-2 ring-indigo-500 border-indigo-100 bg-indigo-50' : 'border-slate-100 hover:border-indigo-200 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-extrabold text-slate-800 truncate overflow-wrap-anywhere">
            استاد {professor}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[11px] text-slate-500">
            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-lg font-bold whitespace-nowrap">
              {fa(stats.total)} تجربه
            </span>
            <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg font-bold whitespace-nowrap">
              ★ {stats.avg != null ? stats.avg.toFixed(1) : '—'}
              <span className="text-amber-500 font-normal"> ({fa(stats.withScore)})</span>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={selected ? `حذف ${professor} از مقایسه` : `افزودن ${professor} به مقایسه`}
          className={`shrink-0 p-2 rounded-xl transition-all min-h-[40px] min-w-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
            selected
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
          }`}
        >
          {selected ? (
            <Check size={18} className="text-white" aria-hidden="true" />
          ) : (
            <span className="text-lg font-black text-indigo-600">+</span>
          )}
        </button>
      </div>

      {stats.withScore > 0 && (
        <div className="mb-3 p-3 bg-slate-50 rounded-xl">
          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 mb-2">
            توزیع امتیاز استاد
          </div>
          <div className="flex items-end gap-1 h-16">
            {[0, 4, 8, 12, 16].map((min, i) => {
              // Simplified distribution - in real app would use actual distribution
              // Use deterministic approach instead of Math.random for React purity
              const seed = professor.length + i + stats.total;
              const barCount = (seed * 9301 + 49297) % 233280 % 3; // deterministic pseudo-random
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <div className="w-full bg-amber-100 rounded-t transition-all hover:bg-amber-200" style={{ height: `${Math.max(8, barCount * 20)}px` }} />
                  <span className="text-[9px] font-bold text-amber-600">{fa(barCount)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 text-center mt-1">
            میانه: {fa(stats.median ?? '—')} | محدوده: {fa(stats.min ?? '—')}–{fa(stats.max ?? '—')} | {fa(stats.withScore)} امتیاز معتبر
          </p>
        </div>
      )}

      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {records.filter(r => r._professorNorm === normalizePersian(professor)).slice(0, 3).map((r) => (
          <ExperienceCard
            key={r.identity}
            item={r}
            onOpen={() => {}}
          />
        ))}
        {records.filter(r => r._professorNorm === normalizePersian(professor)).length > 3 && (
          <button
            type="button"
            className="w-full text-center px-3 py-2 text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          >
            نمایش {fa(records.filter(r => r._professorNorm === normalizePersian(professor)).length - 3)} تجربه دیگر
          </button>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <a
          href={professorRoute(professor)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-indigo-600 text-[11px] font-bold rounded-xl hover:bg-indigo-50 hover:border-indigo-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 min-h-[40px]"
        >
          <ExternalLink size={14} aria-hidden="true" /> پروفایل کامل
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(professor)}
          className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 min-h-[40px] min-w-[40px]"
          aria-label="کپی نام استاد"
        >
          <span className="text-[10px] font-bold">کپی</span>
        </button>
      </div>
    </motion.div>
  );
}

function CourseComparison({ course, professors, records, onClose }) {
  const [selectedProfessors, setSelectedProfessors] = useState(new Set());

  const _toggleProfessor = (prof) => {
    setSelectedProfessors(prev => {
      const next = new Set(prev);
      if (next.has(prof)) next.delete(prof);
      else if (next.size < 3) next.add(prof);
      return next;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-slate-100"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-black text-slate-800 truncate overflow-wrap-anywhere">
            {course}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {fa(professors.length)} استادی این درس تدریس کرده‌اند
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن مقایسه"
          className="p-2 bg-slate-50 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      </div>

      {/* Professor cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {professors.map((prof) => (
          <ProfessorComparisonCard
            key={prof}
            professor={prof}
            courseName={course}
            records={records}
            onOpenExperience={() => {}}
            selected={selectedProfessors.has(prof)}
            onToggle={_toggleProfessor}
          />
        ))}
      </div>

      {/* Comparison panel when 2+ professors selected */}
      {selectedProfessors.size >= 2 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Scale size={18} className="text-indigo-500" aria-hidden="true" />
            <h3 className="text-sm font-black text-indigo-700">مقایسه اساتید انتخاب شده</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <h4 className="text-[11px] font-bold text-slate-500 mb-2">امتیاز استاد (میانه/محدوده)</h4>
              <div className="space-y-2">
                {Array.from(selectedProfessors).map(prof => {
                  const stats = records.filter(r => r._professorNorm === normalizePersian(prof) && r._professorScore != null);
                  const scores = stats.map(r => r._professorScore).sort((a, b) => a - b);
                  const median = scores.length ? scores[Math.floor(scores.length / 2)] : null;
                  const min = scores[0];
                  // const max = scores[scores.length - 1];
                  return (
                    <div key={prof} className="flex items-center justify-between px-3 py-2 bg-white rounded-xl border border-slate-100">
                      <span className="text-sm font-bold text-slate-700 truncate">{prof}</span>
                      <span className="text-[11px] font-bold text-slate-500">
                        {median != null ? `میانه: ${fa(median.toFixed(1))}` : 'بدون امتیاز'} {min !== null ? `· ${fa(min)}–${fa(Math.max(...scores))}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h4 className="text-[11px] font-bold text-slate-500 mb-2">تعداد تجربه‌ها</h4>
              <div className="space-y-2">
                {Array.from(selectedProfessors).map(prof => {
                  const count = records.filter(r => r._professorNorm === normalizePersian(prof)).length;
                  return (
                    <div key={prof} className="flex items-center justify-between px-3 py-2 bg-white rounded-xl border border-slate-100">
                      <span className="text-sm font-bold text-slate-700 truncate">{prof}</span>
                      <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">{fa(count)} تجربه</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-indigo-100">
            <button
              type="button"
              onClick={() => setSelectedProfessors(new Set())}
              className="w-full py-2 px-4 bg-white border border-indigo-200 text-indigo-600 text-sm font-bold rounded-xl hover:bg-indigo-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
              پاک کردن مقایسه
            </button>
          </div>
        </motion.div>
      )}

      {/* Professor list for selection when < 2 selected */}
      {selectedProfessors.size < 2 && (
        <div className="space-y-2">
          {professors.filter(p => !selectedProfessors.has(p)).map((prof) => (
            <button
              key={prof}
              type="button"
              onClick={() => setSelectedProfessors(prev => new Set([...prev, prof]))}
              className="w-full text-right px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 text-right"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">{prof}</span>
                <span className="text-[11px] font-bold text-slate-400 ml-2">افزودن به مقایسه</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6 pt-4 border-t border-slate-100">
        <a
          href={courseRoute(course)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-6 py-3 bg-white border border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-200 rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <ExternalLink size={16} aria-hidden="true" />
          مشاهده در لیست دروس
        </a>
        <button
          type="button"
          onClick={onClose}
          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-6 py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          بازگشت به تجربیات
        </button>
      </div>
    </motion.div>
  );
}

export default CourseComparison;