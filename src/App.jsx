import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, GraduationCap, BookOpen, MessageSquare, X, ArrowLeft, ExternalLink, Star, User, SearchX, Loader2, Users, Cpu, Calendar, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import "overlayscrollbars/overlayscrollbars.css";
import experiencesData from './data.json'; 
import lastUpdateData from './last_update.json';


const toEnglishDigits = (str) => {
  if (!str) return "0";
  const farsiDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let res = String(str);
  for (let i = 0; i < 10; i++) {
    res = res.replace(farsiDigits[i], i).replace(arabicDigits[i], i);
  }
  return res;
};


function App() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedExp, setSelectedExp] = useState(null);
  const [displayCount, setDisplayCount] = useState(12);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const observerTarget = useRef(null);
  const [lastUpdate, setLastUpdate] = useState("در حال بارگذاری...");
  

  const filteredData = useMemo(() => {
    const data = Array.isArray(experiencesData) ? [...experiencesData] : [];
    const sortedByLatest = data.sort((a, b) => b.id - a.id);
    
    if (!searchTerm) return sortedByLatest;

    const lowSearch = searchTerm.toLowerCase();

    const results = sortedByLatest.filter(item =>
      item.course.toLowerCase().includes(lowSearch) || 
      item.professor.toLowerCase().includes(lowSearch)
    );

    return results.sort((a, b) => {
      const scoreA = parseFloat(toEnglishDigits(String(a.Professor_Score))) || 0;
      const scoreB = parseFloat(toEnglishDigits(String(b.Professor_Score))) || 0;

      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.id - a.id;
    });
  }, [searchTerm]);

  const visibleData = useMemo(() => {
    return filteredData.slice(0, displayCount);
  }, [filteredData, displayCount]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayCount < filteredData.length) {
          setTimeout(() => {
            setDisplayCount((prev) => prev + 12);
          }, 150);
        }
      },
      { threshold: 0.1 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [displayCount, filteredData.length]);

  useEffect(() => {
    setDisplayCount(12);
  }, [searchTerm]);

  useEffect(() => {
    if (selectedExp) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedExp]);

  useEffect(() => {
    if (lastUpdateData && lastUpdateData.last_update) {
      setLastUpdate(lastUpdateData.last_update);
    }
  }, []);

  return (
    <OverlayScrollbarsComponent 
      defer
      options={{ scrollbars: { autoHide: 'scroll' } }}
      className="h-screen w-full bg-[#f4f7fb]"
    >
      <div className="min-h-screen flex flex-col font-sans text-right" dir="rtl">
        
        {/* Navigation Bar */}
        <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-200/60 shadow-sm transition-all duration-300">
          <div className="max-w-7xl mx-auto px-4 py-3 md:py-0 md:h-20 flex flex-col justify-center">
            
            <div className="flex items-center justify-between w-full">
              {/* Logo & Title */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 overflow-hidden rounded-xl shadow-md shadow-blue-100 border border-slate-50 bg-white p-0.5">
                  <img src="./logo.png" alt="Logo" className="w-full h-full object-cover rounded-lg" />
                </div>
                <div className="flex flex-col">
                  <span className="text-slate-900 font-black text-lg leading-none tracking-tight">تجربیات</span>
                  <span className="text-[9px] text-blue-500 font-extrabold uppercase tracking-widest mt-1">IAU of Shiraz</span>
                </div>
              </div>

              {/* Desktop Search */}
              <div className="hidden md:block relative flex-1 max-w-md mx-8">
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                  <Search className="text-slate-400" size={18} />
                </div>
                <input
                  type="text"
                  placeholder="جستجوی نام استاد یا درس..."
                  className="w-full bg-slate-100/60 py-2.5 pr-12 pl-4 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white border border-transparent focus:border-blue-200 transition-all placeholder-slate-400 text-slate-700"
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Desktop Links */}
              <div className="hidden lg:flex items-center gap-3">
                <div className="flex gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                  <a href="https://t.me/IAUCourseExp" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                    <MessageSquare size={14} className="text-blue-500" /> کانال تجربیات
                  </a>
                  <a href="https://t.me/IAUCourseExpGroup" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                    <Users size={14} className="text-blue-500" /> گروه تجربیات
                  </a>
                </div>

                <div className="flex gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                  <a href="https://t.me/jozveiau" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white hover:text-indigo-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                    <BookOpen size={14} className="text-indigo-500" /> کانال جزوه
                  </a>
                  <a href="https://t.me/computeriaushz" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white hover:text-cyan-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                    <Cpu size={14} className="text-cyan-500" /> دیسکاشن کامپیوتر
                  </a>
                </div>

                <div className="hidden xl:flex items-center gap-2 px-4 py-2 bg-emerald-50/50 border border-emerald-100/50 rounded-2xl">
                  <Calendar size={14} className="text-emerald-600" />
                  <div className="flex flex-col items-start">
                    <span className="text-[8px] text-emerald-600 font-bold uppercase">Last Update</span>
                    <span id="last-update" className="text-[10px] text-emerald-800 font-black">
                      {lastUpdate}
                    </span>
                  </div>
                </div>
              </div>

              {/* Mobile Menu Toggle */}
              <div className="flex md:hidden items-center gap-2">
                <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors active:scale-95">
                  {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </div>
            </div>

            {/* Mobile Search (Always visible on mobile) */}
            <div className="md:hidden mt-4 relative w-full">
              <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                <Search className="text-slate-400" size={18} />
              </div>
              <input
                type="text"
                placeholder="جستجوی نام استاد یا درس..."
                className="w-full bg-slate-100/70 py-3 pr-10 pl-4 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white border border-transparent focus:border-blue-200 transition-all placeholder-slate-400 text-slate-700"
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Mobile Expanded Menu */}
            <AnimatePresence>
              {isMenuOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="md:hidden overflow-hidden mt-3 flex flex-col gap-2 pt-3 border-t border-slate-100/80"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <a href="https://t.me/IAUCourseExp" className="flex items-center gap-2 p-3 bg-blue-50/70 rounded-xl text-xs font-bold text-slate-700 active:bg-blue-100/70 transition-colors">
                      <MessageSquare size={16} className="text-blue-500" /> کانال تجربیات
                    </a>
                    <a href="https://t.me/IAUCourseExpGroup" className="flex items-center gap-2 p-3 bg-blue-50/70 rounded-xl text-xs font-bold text-slate-700 active:bg-blue-100/70 transition-colors">
                      <Users size={16} className="text-blue-500" /> گروه تجربیات
                    </a>
                    <a href="https://t.me/jozveiau" className="flex items-center gap-2 p-3 bg-indigo-50/70 rounded-xl text-xs font-bold text-slate-700 active:bg-indigo-100/70 transition-colors">
                      <BookOpen size={16} className="text-indigo-500" /> کانال جزوه
                    </a>
                    <a href="https://t.me/computeriaushz" className="flex items-center gap-2 p-3 bg-cyan-50/70 rounded-xl text-xs font-bold text-slate-700 active:bg-cyan-100/70 transition-colors">
                      <Cpu size={16} className="text-cyan-500" /> دیسکاشن کامپیوتر
                    </a>
                  </div>
                  <div className="flex items-center justify-center gap-2 p-3 mt-1 bg-emerald-50/70 rounded-xl text-xs mb-1">
                    <Calendar size={14} className="text-emerald-600" />
                    <span className="text-emerald-800 font-bold">آخرین بروزرسانی: {lastUpdate}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </nav>


        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-12 w-full">
          {/* Status Header */}
          <div className="flex items-center justify-between mb-6 px-1">
            <h1 className="text-lg md:text-xl font-black text-slate-800">
              {searchTerm ? 'نتایج جستجو' : 'آخرین تجارب'}
            </h1>
            <span className="text-xs font-bold text-slate-500 bg-slate-200/50 px-3 py-1 rounded-full">
              {filteredData.length} مورد
            </span>
          </div>

          <AnimatePresence mode="popLayout">
            {visibleData.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 md:gap-6 auto-rows-fr">
                {visibleData.map((item) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={item.id} 
                    onClick={() => setSelectedExp(item)}
                    className="bg-white rounded-[1.5rem] p-5 md:p-6 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_12px_35px_-4px_rgba(0,0,0,0.08)] border border-slate-100 hover:border-blue-100 cursor-pointer transition-all duration-300 group flex flex-col h-full relative"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-base md:text-lg font-extrabold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors line-clamp-1">استاد {item.professor}</h3>
                        <span className="inline-block text-[10px] md:text-[11px] font-bold text-blue-700 bg-blue-50/80 border border-blue-100/50 px-2.5 py-1 rounded-lg truncate max-w-full">
                          {item.course}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                        <div className="flex items-center gap-1 text-[11px] font-black bg-amber-50 text-amber-600 px-2 py-1.5 rounded-lg border border-amber-100/50">
                          <Star size={12} fill="currentColor" /> {item.Professor_Score}
                        </div>
                      </div>
                    </div>
                    
                    <p className="text-slate-500 text-[13px] md:text-sm leading-[1.8] line-clamp-4 text-justify flex-1 mb-5 font-medium">
                      {item.text}
                    </p>
                    
                    <div className="flex items-center justify-between pt-4 border-t border-slate-100/80 mt-auto">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400 font-bold">نمره:</span>
                        <span className="text-sm font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">{item.Student_Score}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs font-bold text-blue-600 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                        <span>جزئیات</span>
                        <ArrowLeft size={14} />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-32 text-slate-400">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <SearchX size={32} className="text-slate-400" />
                </div>
                <p className="font-bold text-lg text-slate-600">موردی یافت نشد</p>
                <p className="text-sm text-slate-400 mt-1">لطفاً کلمات دیگری را امتحان کنید.</p>
              </div>
            )}
          </AnimatePresence>

          {/* Infinite Scroll Loader */}
          <div ref={observerTarget} className="w-full flex flex-col items-center justify-center py-12 h-24">
            {displayCount < filteredData.length && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 text-blue-500">
                <Loader2 className="animate-spin" size={28} />
                <span className="text-xs font-bold text-slate-400">در حال بارگذاری...</span>
              </motion.div>
            )}
            {displayCount >= filteredData.length && filteredData.length > 0 && (
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-widest bg-slate-100 px-4 py-2 rounded-full">
                پایان لیست
              </span>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="w-full py-6 bg-white border-t border-slate-100 text-center mt-auto">
          <div className="text-red-600 font-bold text-sm md:text-base animate-pulse">
            طراحی شده برای دانشجویان آزاد شیراز
          </div>
        </footer>

        {/* Modal / Bottom Sheet */}
        <AnimatePresence>
          {selectedExp && (
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center sm:p-4">
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                onClick={() => setSelectedExp(null)} 
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-[4px]" 
              />
              
              {/* Content Panel */}
              <motion.div 
                initial={{ y: "100%", opacity: 0 }} 
                animate={{ y: 0, opacity: 1 }} 
                exit={{ y: "100%", opacity: 0 }}
                transition={{ type: "spring", damping: 28, stiffness: 300 }}
                className="bg-white w-full max-w-2xl rounded-t-[2rem] md:rounded-[2rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[85vh] md:max-h-[80vh]"
              >
                {/* Modal Header */}
                <div className="px-5 py-4 md:px-6 md:py-5 border-b border-slate-100 flex justify-between items-center bg-white/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
                  <div className="flex items-center gap-3.5 md:gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200/50">
                      <User size={20} className="md:w-6 md:h-6" />
                    </div>
                    <div>
                      <h2 className="text-lg md:text-xl font-black text-slate-900">استاد {selectedExp.professor}</h2>
                      <span className="inline-block mt-0.5 text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border border-blue-100/50">
                        {selectedExp.course}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedExp(null)} className="p-2.5 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all text-slate-500 active:scale-95">
                    <X size={20} />
                  </button>
                </div>
                
                {/* Modal Body */}
                <OverlayScrollbarsComponent 
                  options={{ scrollbars: { autoHide: 'leave' } }} 
                  className="p-5 md:p-8 flex-1 overflow-y-auto overscroll-contain"
                >
                  <p className="leading-[1.9] text-slate-600 text-sm md:text-[15px] text-justify whitespace-pre-line font-medium">
                    {selectedExp.text}
                  </p>
                </OverlayScrollbarsComponent>

                {/* Modal Footer */}
                <div className="p-5 md:p-6 bg-slate-50/80 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
                  <div className="flex gap-6 sm:gap-8 w-full sm:w-auto justify-around sm:justify-start">
                    <div className="flex flex-col items-center sm:items-start">
                      <div className="text-[10px] md:text-[11px] text-slate-400 font-bold mb-1 uppercase tracking-wider">نمره استاد</div>
                      <div className="text-xl font-black text-amber-500 flex items-center gap-1.5">
                        <Star size={18} fill="currentColor" /> {selectedExp.Professor_Score}
                      </div>
                    </div>
                    <div className="w-px bg-slate-200 h-10 hidden sm:block"></div>
                    <div className="flex flex-col items-center sm:items-start">
                      <div className="text-[10px] md:text-[11px] text-slate-400 font-bold mb-1 uppercase tracking-wider">نمره دانشجو</div>
                      <div className="text-xl font-black text-blue-600 bg-white px-3 py-0.5 rounded-lg border border-slate-100 shadow-sm">
                        {selectedExp.Student_Score}
                      </div>
                    </div>
                  </div>
                  
                  <a href={selectedExp.Link} target="_blank" rel="noreferrer" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-3.5 rounded-2xl text-sm font-bold hover:shadow-lg hover:shadow-blue-500/40 transition-all active:scale-[0.98]">
                     مشاهده در تلگرام <ExternalLink size={18} />
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </OverlayScrollbarsComponent>
  );
}
 
export default App;