import { SCORE_BINS } from '../lib/profiles.js';

/**
 * Lightweight SVG/CSS distribution chart over the five 0–20 bins.
 * No charting library (mission §3.7). Accessible: an aria-label summary,
 * a screen-reader table, and visible per-bar counts — understandable
 * without color or JS interaction.
 */
export default function DistributionChart({ distribution, tone = 'blue', label = 'توزیع امتیاز' }) {
  const total = distribution.reduce((a, b) => a + b, 0);
  const max = Math.max(...distribution, 1);
  const tones = {
    blue: 'from-blue-500 to-indigo-500',
    amber: 'from-amber-400 to-amber-500',
  };
  const barTone = tones[tone] || tones.blue;
  const summary = SCORE_BINS.map((bin, i) => `${bin.label}: ${distribution[i]}`).join('، ');

  return (
    <div>
      <div className="flex items-end justify-between gap-2 h-28" role="img" aria-label={`${label} — ${summary}`}>
        {SCORE_BINS.map((bin, i) => {
          const count = distribution[i];
          const pct = total === 0 ? 0 : Math.round((count / max) * 100);
          return (
            <div key={bin.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[11px] font-black text-slate-600" aria-hidden="true">{count.toLocaleString('fa-IR')}</span>
              <div className="w-full bg-slate-100 rounded-t-lg h-20 flex items-end" aria-hidden="true">
                <div
                  className={`w-full rounded-t-lg bg-gradient-to-t ${barTone} transition-all`}
                  style={{ height: `${Math.max(pct, count > 0 ? 6 : 0)}%` }}
                />
              </div>
              <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap" aria-hidden="true">{bin.label}</span>
            </div>
          );
        })}
      </div>
      {/* Screen-reader table equivalent of the chart */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr><th scope="col">بازه امتیاز</th><th scope="col">تعداد</th></tr>
        </thead>
        <tbody>
          {SCORE_BINS.map((bin, i) => (
            <tr key={bin.label}><th scope="row">{bin.label}</th><td>{distribution[i].toLocaleString('fa-IR')}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
