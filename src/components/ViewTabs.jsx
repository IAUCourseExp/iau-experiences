import { GraduationCap, Users, Compass } from 'lucide-react';

const TABS = [
  { hash: '#/', label: 'تجربیات', icon: GraduationCap, section: 'browse' },
  { hash: '#/professors', label: 'پروفایل‌ها', icon: Users, section: 'profiles' },
  { hash: '#/explore', label: 'موضوعات', icon: Compass, section: 'explore' },
];

/**
 * Top-level section switcher (تجربیات / پروفایل‌ها / موضوعات).
 * A compact tab row under the header was chosen over a bottom bar:
 * the header is already sticky, it adds no safe-area/overlay complexity,
 * and three sections fit comfortably at 320 px.
 *
 * @param {string} section one of 'browse' | 'profiles' | 'explore'
 */
export default function ViewTabs({ section }) {
  return (
    <nav aria-label="بخش‌های سایت" className="w-full mt-3">
      <div role="tablist" aria-label="انتخاب بخش" className="flex gap-1 bg-slate-100/80 p-1 rounded-2xl border border-slate-200/60 sm:max-w-[460px] sm:mx-auto">
        {TABS.map((tab) => {
          const active = tab.section === section;
          return (
            <a
              key={tab.hash}
              role="tab"
              aria-selected={active}
              href={tab.hash}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                active
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              <tab.icon size={16} aria-hidden="true" />
              {tab.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
