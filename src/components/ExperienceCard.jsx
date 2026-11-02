import { motion } from 'framer-motion';
import { ArrowLeft, Star } from 'lucide-react';

// Capitalized proxy so ESLint's no-unused-vars sees the JSX usage
// (core rule does not count `<motion.article />` member-expression objects).
const MotionArticle = motion.article;

const FALLBACK_PROFESSOR = 'نام ثبت نشده';
const FALLBACK_TEXT = 'متنی برای این تجربه ثبت نشده است.';

/**
 * One experience card. The whole card is operable through a real <button>
 * stretched over it (keyboard + touch + screen reader), replacing the
 * click-only div of the baseline (A11Y-001). The "جزئیات" affordance is
 * always visible — no hover-only behavior on touch (MOB-001).
 */
export default function ExperienceCard({ item, onOpen }) {
  const professor = item.professor.trim() || FALLBACK_PROFESSOR;
  const course = item.course.trim();
  const text = item.text.trim() || FALLBACK_TEXT;
  const ariaLabel = `مشاهده جزئیات تجربه استاد ${professor}${course ? `، درس ${course}` : ''}`;

  return (
      <MotionArticle
      layout
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.25 }}
      className="group bg-white rounded-[1.5rem] p-5 md:p-6 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_12px_35px_-4px_rgba(0,0,0,0.08)] border border-slate-100 hover:border-blue-100 group-focus-within:border-blue-200 transition-all duration-300 flex flex-col h-full relative"
    >
      <div className="flex items-start justify-between mb-3 gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-base md:text-lg font-extrabold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors line-clamp-1 overflow-wrap-anywhere">
            استاد {professor}
          </h2>
          {course && (
            <span className="inline-block max-w-full text-[10px] md:text-[11px] font-bold text-blue-700 bg-blue-50/80 border border-blue-100/50 px-2.5 py-1 rounded-lg truncate align-top">
              {course}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1 text-[11px] font-black bg-amber-50 text-amber-600 px-2 py-1.5 rounded-lg border border-amber-100/50">
            <Star size={12} fill="currentColor" aria-hidden="true" /> {item.Professor_Score}
          </div>
        </div>
      </div>

      <p className="text-slate-500 text-[13px] md:text-sm leading-[1.8] line-clamp-4 text-justify flex-1 mb-5 font-medium">
        {text}
      </p>

      <div className="flex items-center justify-between pt-4 border-t border-slate-100/80 mt-auto">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-bold">نمره:</span>
          <span className="text-sm font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">{item.Student_Score}</span>
        </div>
        <div className="flex items-center gap-1 text-xs font-bold text-blue-600 transition-transform duration-300 group-hover:-translate-x-0.5" aria-hidden="true">
          <span>جزئیات</span>
          <ArrowLeft size={14} />
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className="absolute inset-0 w-full h-full rounded-[1.5rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      />
    </MotionArticle>
  );
}
