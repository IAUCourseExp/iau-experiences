import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, GraduationCap, BookOpen, MessageSquare, X, ArrowLeft, ExternalLink, Star, User, SearchX, Loader2, Users, Cpu, Calendar } from 'lucide-react';
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
          }, 300);
        }
      },
      { threshold: 1.0 }
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
      className="h-screen w-full"
    >
      <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-right" dir="rtl">
        
        <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between gap-6">
            
            <div className="flex flex-col md:flex-row items-center gap-6 w-full md:w-auto">
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-12 h-12 shrink-0 overflow-hidden rounded-xl shadow-lg shadow-blue-200/50 border border-white">
                  <img 
                    src="./logo.png"
                    alt="Logo"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-slate-900 font-black text-base leading-none">تجربیات</span>
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">IAU of Shiraz</span>
                </div>
              </div>

              <div className="relative w-full md:w-64 xl:w-80">
                <input
                  type="text"
                  placeholder="جستجوی سریع..."
                  className="w-full bg-slate-100/80 py-2 px-10 rounded-xl text-xs outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white border border-transparent focus:border-blue-200 transition-all"
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-4">
              <div className="flex gap-1 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
                <a href="https://t.me/IAUCourseExp" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                  <MessageSquare size={14} className="text-blue-500" /> کانال تجربیات
                </a>
                <a href="https://t.me/IAUCourseExpGroup" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                  <Users size={14} className="text-blue-500" /> گروه تجربیات
                </a>
              </div>

              <div className="flex gap-1 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
                <a href="https://t.me/jozveiau" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-white hover:text-indigo-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                  <BookOpen size={14} className="text-indigo-500" /> کانال جزوه
                </a>
                <a href="https://t.me/computeriaushz" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-white hover:text-cyan-600 rounded-xl transition-all shadow-sm shadow-transparent hover:shadow-slate-200/50">
                  <Cpu size={14} className="text-cyan-500" /> دیسکاشن کامپیوتر
                </a>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-2xl">
              <Calendar size={14} className="text-emerald-600" />
              <div className="flex flex-col items-start">
                <span className="text-[8px] text-emerald-500 font-bold uppercase">Last Update</span>
                <span id="last-update" className="text-[10px] text-emerald-700 font-black">
                  {lastUpdate}
                </span>
              </div>
            </div>
          </div>
        </nav>


        <main className="flex-1 max-w-7xl mx-auto px-4 pt-10 w-full">
          <AnimatePresence mode="popLayout">
            {visibleData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {visibleData.map((item) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={item.id} 
                    onClick={() => setSelectedExp(item)}
                    className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 cursor-pointer hover:shadow-xl transition-all group h-64 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg truncate max-w-[120px]">
                          {item.course}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] font-black text-amber-500">
                          <Star size={12} fill="currentColor" /> {item.Professor_Score}
                        </div>
                      </div>
                      <h3 className="text-lg font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors">استاد {item.professor}</h3>
                      <p className="text-slate-500 text-xs leading-relaxed line-clamp-4 text-justify">
                        {item.text}
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-50">
                      <span className="text-[10px] text-slate-400 font-bold">نمره: {item.Student_Score}</span>
                      <div className="text-blue-600 group-hover:translate-x-[-4px] transition-transform">
                        <ArrowLeft size={16} />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <SearchX size={48} className="mb-4 opacity-20" />
                <p className="font-bold">موردی یافت نشد</p>
              </div>
            )}
          </AnimatePresence>

          <div ref={observerTarget} className="w-full flex flex-col items-center justify-center py-12">
            {displayCount < filteredData.length && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 text-blue-600">
                <Loader2 className="animate-spin" size={32} />
                <span className="text-xs font-bold text-slate-400">در حال بارگذاری تجربه‌ها...</span>
              </motion.div>
            )}
            {displayCount >= filteredData.length && filteredData.length > 0 && (
              <span className="text-xs font-bold text-slate-300">پایان لیست تجربه‌ها</span>
            )}
          </div>
        </main>

        <footer className="w-full py-6 bg-white border-t border-slate-100 text-center mt-auto">
          <div className="text-red-600 font-bold text-sm md:text-base animate-pulse">
            طراحی شده برای دانشجویان آزاد شیراز
          </div>
          <div className="text-[10px] text-gray-400 mt-1 font-medium">
            برای مشاهده بهتر از نسخه دسکتاپ استفاده کنید
          </div>
        </footer>

        <AnimatePresence>
          {selectedExp && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedExp(null)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden">
                <div className="p-8 md:p-10">
                  <div className="flex justify-between items-start mb-8">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                        <User size={24} />
                      </div>
                      <div>
                        <h2 className="text-xl font-black text-slate-900">استاد {selectedExp.professor}</h2>
                        <span className="text-blue-600 text-xs font-bold">{selectedExp.course}</span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedExp(null)} className="p-2 bg-slate-100 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all">
                      <X size={20} />
                    </button>
                  </div>
                  <OverlayScrollbarsComponent options={{ scrollbars: { autoHide: 'leave' } }} className="max-h-[40vh] mb-8 pr-4">
                    <p className="leading-relaxed text-slate-600 text-base text-justify whitespace-pre-line">{selectedExp.text}</p>
                  </OverlayScrollbarsComponent>
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-100">
                    <div className="flex gap-6">
                      <div className="text-center">
                        <div className="text-[10px] text-slate-400 font-bold mb-1">نمره استاد</div>
                        <div className="text-lg font-black text-amber-500 flex items-center gap-1"><Star size={16} fill="currentColor" /> {selectedExp.Professor_Score}</div>
                      </div>
                      <div className="text-center border-r border-slate-100 pr-6">
                        <div className="text-[10px] text-slate-400 font-bold mb-1">نمره دانشجو</div>
                        <div className="text-lg font-black text-blue-600">{selectedExp.Student_Score}</div>
                      </div>
                    </div>
                    <a href={selectedExp.Link} target="_blank" rel="noreferrer" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl text-sm font-bold hover:bg-blue-600 transition-all shadow-xl">
                       لینک تلگرام <ExternalLink size={16} />
                    </a>
                  </div>
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
