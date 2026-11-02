import { Search, X } from 'lucide-react';

/**
 * Single controlled search field. Rendered once per breakpoint from the same
 * `value` state, so the visible query can never go out of sync with the
 * applied filter (baseline issue SRCH-001).
 */
export default function SearchField({ id, value, onChange, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">جستجوی نام استاد یا درس</label>
      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none" aria-hidden="true">
        <Search className="text-slate-400" size={18} />
      </div>
      <input
        id={id}
        name={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="جستجوی نام استاد یا درس..."
        autoComplete="off"
        enterKeyHint="search"
        className="search-input w-full bg-slate-100/60 py-2.5 pr-12 pl-11 rounded-2xl text-base font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white border border-transparent focus:border-blue-200 transition-all placeholder-slate-400 text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500/30"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="پاک کردن جستجو"
          className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 hover:text-slate-600 focus-visible:text-slate-600 focus-visible:outline-none"
        >
          <span className="p-1.5 rounded-full bg-slate-200/70 hover:bg-slate-300/70 transition-colors flex">
            <X size={14} />
          </span>
        </button>
      )}
    </div>
  );
}
