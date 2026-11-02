import React from 'react';

/**
 * Last-resort error boundary (RELY-001): a single malformed record must never
 * white-screen the whole site. Records are already sanitized in
 * `toSearchable`, so this only catches genuinely unexpected render errors.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Surface for diagnostics without any external reporting service.
    console.error('IAU Experiences render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f7fb] text-right px-6" dir="rtl">
          <div className="bg-white rounded-[1.5rem] shadow-md border border-slate-100 p-8 max-w-sm text-center">
            <h1 className="text-lg font-black text-slate-800 mb-2">مشکلی پیش آمد</h1>
            <p className="text-sm text-slate-500 leading-7 mb-5">
              در نمایش تجربه‌ها خطایی رخ داد. با تازه‌سازی صفحه معمولاً مشکل برطرف می‌شود.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              تازه‌سازی صفحه
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
