import { GraduationCap, Users, Compass } from 'lucide-react';

const TABS = [
  { hash: '#/', label: 'تجربیات', icon: GraduationCap, section: 'browse' },
  { hash: '#/professors', label: 'پروفایل‌ها', icon: Users, section: 'profiles' },
  { hash: '#/explore', label: 'موضوعات', icon: Compass, section: 'explore' },
];

/**
 * Top-level section switcher (تجربیات / پروفایل‌ها / موضوعات).
 *
 * Two layout variants of the same three destinations, so the nav never
 * duplicates real estate on any breakpoint:
 *  - "bar" (default, < lg): full-width segmented row under the brand row.
 *  - "inline" (lg+): compact pills inside the single desktop header row.
 * The inactive variant is display:none, so exactly one tablist is exposed
 * to assistive technology at any viewport.
 *
 * @param {string} section one of 'browse' | 'profiles' | 'explore'
 */
export default function ViewTabs({ section, variant = 'bar' }) {
  const isInline = variant === 'inline';
  return (
    <nav
      aria-label="بخش‌های سایت"
      className={isInline ? 'hidden lg:block' : 'lg:hidden w-full mt-1'}
    >
      <div
        role="tablist"
        aria-label="انتخاب بخش"
        className={
          isInline
            ? 'flex gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/60'
            : 'flex gap-1 bg-slate-100/80 p-1 rounded-2xl border border-slate-200/60'
        }
      >
        {TABS.map((tab) => {
          const active = tab.section === section;
          return (
            <a
              key={tab.hash}
              role="tab"
              aria-selected={active}
              href={tab.hash}
              className={`flex items-center justify-center gap-1.5 font-bold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                isInline
                  ? 'px-3 py-1.5 text-xs min-h-[36px] whitespace-nowrap'
                  : 'flex-1 px-2 py-2 text-xs sm:text-sm min-h-[42px] rounded-xl'
              } ${
                active
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              <tab.icon size={15} aria-hidden="true" />
              {tab.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
