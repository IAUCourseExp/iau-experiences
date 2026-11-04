import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { normalizePersian } from '../lib/search.js';

/**
 * Searchable combobox for long option lists (ARIA 1.2 pattern).
 *
 * Why this exists (Phase 5 audit): the explorer and directory filters offered
 * 450-1000 options in a native <select>, which is unnavigable in practice.
 * Short option lists (sort order, sample thresholds) stay native selects —
 * this component is only for lists too long to scan.
 *
 * Semantics:
 *  - The input carries role="combobox" with aria-expanded, aria-controls and
 *    aria-activedescendant; the popup is a role="listbox" of role="option"
 *    elements. No clickable-div fakery.
 *  - ArrowUp/ArrowDown move the active option, Enter selects it, Escape
 *    closes the popup (and clears the query when already closed), Tab closes.
 *  - Filtering uses the project's normalizePersian, so Arabic/Persian
 *    variants (ي/ی، ك/ک) and digit forms match exactly like site search.
 *  - The visible text shows the SELECTED option's label after selection;
 *    typing again starts a new query and clears the selection — the shown
 *    value and the applied filter can never disagree.
 *  - The option list is capped for rendering performance; a footer tells the
 *    user to refine the query instead of silently hiding matches.
 */

const MAX_RENDERED_OPTIONS = 60;

export default function Combobox({
  id,
  label,
  value,
  onChange,
  options,          // Array<{ value: string, label: string, hint?: string|number }>
  placeholder,
  allLabel,         // label shown for the "no filter" empty value
  emptyMessage = 'گزینه‌ای یافت نشد.',
}) {
  const reactUseId = useId();
  const inputId = id || `${reactUseId}-input`;
  const listboxId = `${inputId}-listbox`;
  const activeIdBase = `${inputId}-option`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value]
  );

  // The input displays the user's query while the popup is open and mirrors
  // the applied selection while closed — derived, never effect-synced, so an
  // external value reset (clear filters) is reflected immediately.
  const filtered = useMemo(() => {
    const needle = normalizePersian(query).trim();
    if (!needle) return options;
    return options.filter((opt) => normalizePersian(opt.label).includes(needle));
  }, [options, query]);

  const capped = filtered.length > MAX_RENDERED_OPTIONS;
  const shown = capped ? filtered.slice(0, MAX_RENDERED_OPTIONS) : filtered;
  const clampedActive = Math.min(activeIndex, shown.length - 1);

  function openPopup() {
    setOpen(true);
    setActiveIndex(0);
    setQuery(selectedOption ? selectedOption.label : '');
  }

  function closePopup(refocus = false) {
    setOpen(false);
    setQuery(selectedOption ? selectedOption.label : '');
    if (refocus) inputRef.current?.focus();
  }

  function commitSelection(option) {
    onChange(option.value);
    setOpen(false);
    setQuery(option.value === '' ? '' : option.label);
    inputRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { openPopup(); return; }
      setActiveIndex((i) => Math.min(i + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { openPopup(); return; }
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      if (open) {
        event.preventDefault();
        const target = shown[clampedActive] ?? (shown.length === 1 ? shown[0] : null);
        if (target) commitSelection(target);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closePopup(true);
      } else if (value !== '') {
        // second Escape (popup already closed) clears the applied filter
        onChange('');
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  // Close on pointer-down outside, like the site menu.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const hasValue = value !== '';

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="sr-only">{label}</label>
      <div className="relative">
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none" aria-hidden="true">
          <Search size={15} className="text-slate-400" />
        </div>
        <input
          ref={inputRef}
          id={inputId}
          name={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && clampedActive >= 0 ? `${activeIdBase}-${clampedActive}` : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          value={open ? query : (selectedOption ? selectedOption.label : '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(0); }}
          onFocus={openPopup}
          onClick={openPopup}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full bg-white border rounded-xl text-[13px] font-bold py-2 pr-9 pl-16 min-h-[40px] outline-none transition-all placeholder:text-slate-400 placeholder:font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
            hasValue ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'
          }`}
        />
        <div className="absolute inset-y-0 left-0 pl-1.5 flex items-center gap-0.5">
          {hasValue && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                onChange('');
                setQuery('');
                // Focus after the state flush: focusing synchronously fires
                // onFocus → openPopup with the STALE selectedOption and
                // re-fills the input with the label just being cleared.
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              aria-label={`${label}: پاک کردن مقدار انتخاب‌شده`}
              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <span className="p-1 text-slate-400 pointer-events-none" aria-hidden="true">
            <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </span>
        </div>
      </div>

      {open && (
        <div className="absolute z-30 top-[calc(100%+4px)] right-0 left-0 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            // Keep focus on the combobox input while choosing an option
            // (standard combobox behavior; arrow keys keep working).
            onMouseDown={(e) => e.preventDefault()}
            className="max-h-72 overflow-y-auto py-1"
          >
            <li
              id={`${activeIdBase}-all`}
              role="option"
              aria-selected={!hasValue}
              // Commit on pointerdown: a trusted mouse sequence can re-render
              // the list between mousedown and click, which would deliver the
              // click event to a detached node (observed in Playwright runs).
              onPointerDown={() => commitSelection({ value: '', label: '' })}
              onClick={() => commitSelection({ value: '', label: '' })}
              className={`px-3 py-2.5 text-[12px] font-bold cursor-pointer min-h-[40px] flex items-center ${
                !hasValue ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {allLabel}
            </li>
            {shown.map((opt, i) => (
              <li
                key={opt.value}
                id={`${activeIdBase}-${i}`}
                role="option"
                aria-selected={opt.value === value}
                onPointerDown={() => commitSelection(opt)}
                onClick={() => commitSelection(opt)}
                className={`px-3 py-2.5 text-[12px] font-bold cursor-pointer min-h-[40px] flex items-center justify-between gap-2 overflow-wrap-anywhere ${
                  opt.value === value
                    ? 'bg-blue-600 text-white'
                    : i === clampedActive
                      ? 'bg-blue-50 text-slate-800'
                      : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {opt.hint != null && (
                  <span className={`shrink-0 text-[10px] font-black ${opt.value === value ? 'text-blue-100' : 'text-slate-400'}`}>
                    {opt.hint}
                  </span>
                )}
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-3 py-3 text-[11px] font-bold text-slate-400" role="status">
                {emptyMessage}
              </li>
            )}
          </ul>
          {capped && (
            <p className="px-3 py-2 border-t border-slate-100 text-[10px] font-bold text-slate-400 bg-slate-50/70">
              {filtered.length.toLocaleString('fa-IR')} گزینه یافت شد؛ برای دیدن موارد بیشتر، جستجو را دقیق‌تر کنید.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
