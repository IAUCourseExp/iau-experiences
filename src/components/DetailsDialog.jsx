import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ExternalLink, Star, User, Share2, Check, Link2, Copy, Type, Sparkles } from 'lucide-react';
import { normalizePersian } from '../lib/search.js';
import { professorRoute, courseRoute } from '../lib/router.js';
import { loadNeighborsArtifact, bindArtifact, neighborsFor } from '../lib/atlas.js';

// Capitalized proxy so ESLint's no-unused-vars sees the JSX usage
// (core rule does not count `<motion.div />` member-expression objects).
const MotionDiv = motion.div;

const FALLBACK_PROFESSOR = 'نام ثبت نشده';
const FALLBACK_TEXT = 'متنی برای این تجربه ثبت نشده است.';
const TEXT_SIZE_KEY = 'iau-exp-textsize';

function readStoredTextSize() {
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY);
    return ['sm', 'md', 'lg'].includes(v) ? v : 'md';
  } catch {
    return 'md';
  }
}

function storeTextSize(size) {
  try {
    localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch {
    /* unavailable storage — preference simply won't persist */
  }
}

const TEXT_SIZES = [
  { key: 'sm', label: 'کوچک', cls: 'text-[13px]' },
  { key: 'md', label: 'متوسط', cls: 'text-sm md:text-[15px]' },
  { key: 'lg', label: 'بزرگ', cls: 'text-base md:text-lg' },
];

function isSafeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible details dialog: bottom sheet on mobile, centered dialog on desktop.
 * Dialog semantics, Escape, focus trap + restore, native body scroll lock,
 * share/copy of the experience deep link, related experiences, and a
 * reading-size preference (Phase II).
 */
export default function DetailsDialog({ exp, related, onOpenExperience, recordById, datasetChecksum, onClose }) {
  const panelRef = useRef(null);
  const lastActiveRef = useRef(null);
  const [shareState, setShareState] = useState('idle'); // idle | copied | failed
  const [copyTextState, setCopyTextState] = useState('idle');
  const [textSize, setTextSize] = useState(readStoredTextSize);
  // Semantic neighbors: loaded on explicit user action only (≈345 KB artifact,
  // mission §12 — never parsed on the initial route).
  const [semanticState, setSemanticState] = useState('idle'); // idle|loading|ready|unavailable|unbound|empty
  const [semanticList, setSemanticList] = useState([]);

  const professor = exp.professor.trim() || FALLBACK_PROFESSOR;
  const course = exp.course.trim();
  const text = exp.text.trim() || FALLBACK_TEXT;
  const linkOk = isSafeHttpUrl(exp.Link);
  const sizeCls = (TEXT_SIZES.find((s) => s.key === textSize) || TEXT_SIZES[1]).cls;

  // Focus management: remember opener, move focus in, restore on close.
  useEffect(() => {
    lastActiveRef.current = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const closeBtn = panel.querySelector('[data-dialog-close]');
      if (closeBtn) closeBtn.focus();
      else panel.focus();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      const toRestore = lastActiveRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus();
      }
    };
  }, []);

  // Keyboard: Escape closes, Tab is trapped inside the dialog.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  function experienceDeepLink() {
    return `${window.location.origin}${window.location.pathname}#/experience/${encodeURIComponent(exp.identity)}`;
  }

  async function handleShare() {
    const url = experienceDeepLink();
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `تجربه استاد ${professor}`, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareState('copied');
    } catch {
      setShareState('failed');
    }
    setTimeout(() => setShareState('idle'), 2000);
  }

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(exp.text.trim());
      setCopyTextState('copied');
    } catch {
      setCopyTextState('failed');
    }
    setTimeout(() => setCopyTextState('idle'), 2000);
  }

  function changeTextSize(size) {
    setTextSize(size);
    storeTextSize(size);
  }

  async function loadSemanticNeighbors() {
    setSemanticState('loading');
    try {
      const artifact = await loadNeighborsArtifact();
      const binding = bindArtifact(artifact, datasetChecksum);
      if (!binding.bound || binding.mode !== 'semantic') {
        setSemanticState(binding.bound ? 'unavailable' : 'unbound');
        return;
      }
      const list = neighborsFor(artifact, exp.identity);
      if (!list || list.length === 0) {
        setSemanticState('empty');
        return;
      }
      setSemanticList(list);
      setSemanticState('ready');
    } catch {
      setSemanticState('unavailable');
    }
  }

  const relatedSameProf = (related?.sameProfessor || []).slice(0, 4);
  const relatedSameCourse = (related?.sameCourse || []).slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center sm:p-4">
      {/* Backdrop */}
      <MotionDiv
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[4px]"
      />

      {/* Content panel */}
      <MotionDiv
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exp-dialog-title"
        tabIndex={-1}
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="bg-white w-full max-w-2xl rounded-t-[2rem] md:rounded-[2rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[85vh] [@supports(height:100dvh)]:max-h-[85dvh] md:max-h-[80vh] outline-none"
      >
        {/* Dialog header */}
        <div className="px-5 py-4 md:px-6 md:py-5 border-b border-slate-100 flex justify-between items-center gap-3 bg-white/95 backdrop-blur-md sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3.5 md:gap-4 min-w-0">
            <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200/50">
              <User size={20} className="md:w-6 md:h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="exp-dialog-title" className="text-lg md:text-xl font-black text-slate-900 truncate overflow-wrap-anywhere">
                {exp.professor.trim() ? (
                  <a href={professorRoute(normalizePersian(exp.professor))} onClick={onClose} className="hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded">
                    استاد {professor}
                  </a>
                ) : (
                  <>استاد {professor}</>
                )}
              </h2>
              {course && (
                <a href={courseRoute(normalizePersian(course))} onClick={onClose} className="inline-block mt-0.5 max-w-full truncate text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border border-blue-100/50 align-top hover:bg-blue-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                  {course}
                </a>
              )}
            </div>
          </div>
          <button
            type="button"
            data-dialog-close
            onClick={onClose}
            aria-label="بستن جزئیات تجربه"
            className="p-2.5 bg-slate-50 hover:bg-slate-100 focus-visible:bg-slate-100 rounded-xl transition-all text-slate-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 shrink-0"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Dialog body — native scrolling */}
        <div className="p-5 md:p-8 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1" role="group" aria-label="اندازه متن">
              <Type size={14} className="text-slate-400" aria-hidden="true" />
              {TEXT_SIZES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => changeTextSize(s.key)}
                  aria-pressed={textSize === s.key}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    textSize === s.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyText}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 hover:text-blue-700 hover:border-blue-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              aria-live="polite"
            >
              {copyTextState === 'copied' ? (
                <><Check size={12} className="text-emerald-500" aria-hidden="true" /> متن کپی شد</>
              ) : (
                <><Copy size={12} aria-hidden="true" /> کپی متن تجربه</>
              )}
            </button>
          </div>

          <p className={`leading-[2] text-slate-600 text-justify whitespace-pre-line font-medium ${sizeCls}`}>
            {text}
          </p>

          {/* Semantic neighbors (Phase III — build-time precomputed) */}
          <div className="mt-6">
            {semanticState === 'idle' && (
              <button
                type="button"
                onClick={loadSemanticNeighbors}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50/70 text-indigo-700 text-xs font-black rounded-xl hover:bg-indigo-100/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 min-h-[44px]"
              >
                <Sparkles size={14} aria-hidden="true" />
                نمایش تجربه‌های موضوعاً مشابه (پیش‌محاسبه‌شده)
              </button>
            )}
            {semanticState === 'loading' && (
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400" role="status">
                <span className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" aria-hidden="true" />
                در حال بارگذاری مشابه‌ها...
              </div>
            )}
            {semanticState === 'ready' && (
              <div>
                <h3 className="text-xs font-black text-slate-600 mb-2">تجربه‌های نزدیک از نظر موضوعی</h3>
                <p className="text-[10px] font-bold text-slate-400 mb-2 leading-5">
                  بر اساس شباهت معنایی محاسبه‌شده در زمان ساخت داده؛ ترتیب نزدیکی است، نه ارزش‌گذاری یا درصدها.
                </p>
                <div className="flex flex-col gap-2">
                  {semanticList.map((n) => {
                    const rec = recordById ? recordById.get(n.id) : null;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => onOpenExperience(rec || { identity: n.id })}
                        className="text-right flex items-center justify-between gap-3 bg-white border border-slate-100 hover:border-indigo-200 rounded-xl px-3.5 py-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                      >
                        <span className="text-[11px] font-bold text-slate-600 truncate overflow-wrap-anywhere">
                          {rec ? `استاد ${rec.professor.trim() || 'نامشخص'}${rec.course.trim() ? ` — ${rec.course.trim()}` : ''}` : `تجربه شماره ${String(n.id)}`}
                        </span>
                        <span className="shrink-0 text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100/60 px-1.5 py-0.5 rounded">مشابه</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {semanticState === 'unbound' && (
              <p className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                نسخه‌ی مشابه‌ها با داده‌های فعلی هم‌خوانی ندارد؛ برای پرهیز از نمایش نتیجه‌ی قدیمی، این بخش غیرفعال است.
              </p>
            )}
            {(semanticState === 'unavailable' || semanticState === 'empty') && (
              <p className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                {semanticState === 'empty' ? 'مشابه معنایی ثبت‌شده‌ای برای این تجربه پیدا نشد.' : 'فهرست مشابه‌های معنایی در دسترس نیست.'}
              </p>
            )}
          </div>

          {/* Related experiences (Phase II) */}
          {(relatedSameProf.length > 0 || relatedSameCourse.length > 0) && (
            <div className="mt-8 pt-5 border-t border-slate-100">
              <h3 className="text-xs font-black text-slate-600 mb-3">تجربه‌های مرتبط</h3>
              <div className="flex flex-col gap-2">
                {relatedSameProf.map((r) => (
                  <button
                    key={`p-${r.identity}`}
                    type="button"
                    onClick={() => onOpenExperience(r)}
                    className="text-right flex items-center justify-between gap-3 bg-white border border-slate-100 hover:border-blue-200 rounded-xl px-3.5 py-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  >
                    <span className="text-[11px] font-bold text-slate-600 truncate overflow-wrap-anywhere">
                      {r.text.trim().slice(0, 70) || 'بدون متن'}…
                    </span>
                    <span className="shrink-0 text-[9px] font-black text-blue-700 bg-blue-50 border border-blue-100/60 px-1.5 py-0.5 rounded">از همین استاد</span>
                  </button>
                ))}
                {relatedSameCourse.map((r) => (
                  <button
                    key={`c-${r.identity}`}
                    type="button"
                    onClick={() => onOpenExperience(r)}
                    className="text-right flex items-center justify-between gap-3 bg-white border border-slate-100 hover:border-indigo-200 rounded-xl px-3.5 py-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                  >
                    <span className="text-[11px] font-bold text-slate-600 truncate overflow-wrap-anywhere">
                      استاد {r.professor.trim() || 'نامشخص'} — {r.text.trim().slice(0, 50) || 'بدون متن'}…
                    </span>
                    <span className="shrink-0 text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100/60 px-1.5 py-0.5 rounded">همین درس</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Dialog footer */}
        <div className="p-5 md:p-6 pt-4 md:pt-4 bg-slate-50/80 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:pb-6">
          <div className="flex gap-6 sm:gap-8 w-full sm:w-auto justify-around sm:justify-start">
            <div className="flex flex-col items-center sm:items-start">
              <div className="text-[10px] md:text-[11px] text-slate-400 font-bold mb-1 tracking-wider">
                امتیاز استاد
              </div>
              <div className="text-xl font-black text-amber-500 flex items-center gap-1.5">
                <Star size={18} fill="currentColor" aria-hidden="true" /> {exp.Professor_Score}
              </div>
            </div>
            <div className="w-px bg-slate-200 h-10 hidden sm:block" aria-hidden="true"></div>
            <div className="flex flex-col items-center sm:items-start">
              <div className="text-[10px] md:text-[11px] text-slate-400 font-bold mb-1 tracking-wider">
                نمره دانشجو
              </div>
              <div className="text-xl font-black text-blue-600 bg-white px-3 py-0.5 rounded-lg border border-slate-100 shadow-sm">
                {exp.Student_Score}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 px-4 py-3 sm:py-3.5 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              aria-live="polite"
            >
              {shareState === 'copied' ? (
                <>
                  <Check size={18} className="text-emerald-500" aria-hidden="true" /> لینک کپی شد
                </>
              ) : shareState === 'failed' ? (
                <>
                  <Link2 size={18} aria-hidden="true" /> لینک تجربه
                </>
              ) : (
                <>
                  <Share2 size={18} aria-hidden="true" /> اشتراک‌گذاری تجربه
                </>
              )}
            </button>
            {linkOk ? (
              <a
                href={exp.Link}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-3.5 rounded-2xl text-sm font-bold hover:shadow-lg hover:shadow-blue-500/40 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2"
              >
                مشاهده در تلگرام <ExternalLink size={18} aria-hidden="true" />
              </a>
            ) : (
              <span className="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-100 text-slate-400 px-8 py-3.5 rounded-2xl text-sm font-bold" role="note">
                لینک اصلی در دسترس نیست
              </span>
            )}
          </div>
        </div>
      </MotionDiv>
    </div>
  );
}
