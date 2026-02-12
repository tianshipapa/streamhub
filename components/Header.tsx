
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ViewState } from '../types';
import { Icon } from './Icon';
import { fetchViaProxy } from '../utils/api';

interface HeaderProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onBack: () => void;
  onSearch: (query: string, autoAggregate?: boolean) => void;
}

const Header: React.FC<HeaderProps> = ({ currentView, setView, onBack, onSearch }) => {
  const [searchValue, setSearchValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hotSearchList, setHotSearchList] = useState<string[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  // 延时关闭的引用
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载搜索历史
  useEffect(() => {
    try {
      const history = localStorage.getItem('streamhub_search_history');
      if (history) {
        setSearchHistory(JSON.parse(history));
      }
    } catch (e) {}
  }, []);

  // 加载 360kan 热搜数据
  useEffect(() => {
    const fetchHotWords = async () => {
      try {
        const response = await fetchViaProxy('https://api.web.360kan.com/v1/query/addef?ver=2');
        const json = JSON.parse(response);
        if (json.data && Array.isArray(json.data)) {
           // 提取 title 字段
           const titles = json.data.map((item: any) => item.title).filter((t: any) => typeof t === 'string' && t);
           setHotSearchList(titles);
        }
      } catch (e) {
        // 静默失败
      }
    };
    fetchHotWords();
  }, []);

  // 点击外部关闭建议框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveHistory = (query: string) => {
    const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
    setSearchHistory(newHistory);
    localStorage.setItem('streamhub_search_history', JSON.stringify(newHistory));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      saveHistory(searchValue.trim());
      onSearch(searchValue.trim());
      setView('SEARCH');
      setShowSuggestions(false);
      (document.activeElement as HTMLElement)?.blur();
    }
  };

  const handleSuggestionClick = (item: string) => {
    setSearchValue(item);
    saveHistory(item);
    onSearch(item);
    setView('SEARCH');
    setShowSuggestions(false);
  };

  const clearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchHistory([]);
    localStorage.removeItem('streamhub_search_history');
    // Keep focus in input
    searchContainerRef.current?.querySelector('input')?.focus();
  };

  const handleContainerLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setShowSuggestions(false);
    }, 300);
  };

  const handleContainerEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  // --- Keyboard Navigation Logic ---

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
          e.preventDefault();
          const firstBtn = suggestionsRef.current?.querySelector('button.search-tag') as HTMLElement;
          if (firstBtn) firstBtn.focus();
      }
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();

    const container = suggestionsRef.current;
    if (!container) return;

    const buttons = Array.from(container.querySelectorAll('button.search-tag')) as HTMLElement[];
    const current = document.activeElement as HTMLElement;
    const idx = buttons.indexOf(current);
    
    if (idx === -1) return;

    // Responsive columns approximation (match grid-cols-2 sm:grid-cols-3)
    const cols = window.innerWidth >= 640 ? 3 : 2;
    
    let nextIdx = idx;

    if (e.key === 'ArrowRight') nextIdx = idx + 1;
    else if (e.key === 'ArrowLeft') nextIdx = idx - 1;
    else if (e.key === 'ArrowDown') nextIdx = idx + cols;
    else if (e.key === 'ArrowUp') nextIdx = idx - cols;

    // Boundary handling
    if (nextIdx < 0) {
        // Return to input
        const input = searchContainerRef.current?.querySelector('input');
        input?.focus();
        return;
    }

    if (nextIdx >= buttons.length) nextIdx = buttons.length - 1;
    if (buttons[nextIdx]) buttons[nextIdx].focus();
  };

  return (
    <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2 sm:gap-4">
          
          {/* Logo Section */}
          <div 
            className="flex-shrink-0 flex items-center cursor-pointer group outline-none focus:ring-2 focus:ring-blue-500 rounded-lg"
            onClick={() => setView('HOME')}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setView('HOME')}
          >
            <div className={`mr-1 sm:mr-2 rounded-lg flex items-center justify-center transition-all duration-300 ${currentView === 'SEARCH' ? 'w-8 h-8 sm:w-10 sm:h-10 bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-blue-600'}`}>
              <Icon 
                name="play_circle_filled" 
                className={currentView === 'SEARCH' ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}
                type="round"
              />
            </div>
            <h1 className="text-sm sm:text-xl font-bold tracking-tight text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors whitespace-nowrap">
              StreamHub
              <span className="hidden sm:inline">{currentView === 'HOME' && ' 视界'}</span>
            </h1>
          </div>

          {/* Search Bar Section */}
          <div 
            className="flex-1 max-w-2xl mx-auto px-1 sm:px-0 relative" 
            ref={searchContainerRef}
            onMouseLeave={handleContainerLeave}
            onMouseEnter={handleContainerEnter}
          >
            <form onSubmit={handleSearchSubmit} className="relative group">
              <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
                <Icon name="search" className="text-gray-400 group-focus-within:text-blue-500 transition-colors text-lg sm:text-xl" />
              </div>
              <input
                type="text"
                className="block w-full pl-8 sm:pl-10 pr-2 sm:pr-3 py-1.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-full leading-5 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs sm:text-sm transition-all duration-300 shadow-inner"
                placeholder="搜索电影、剧集、动漫..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onFocus={() => { handleContainerEnter(); setShowSuggestions(true); }}
                onClick={() => { handleContainerEnter(); setShowSuggestions(true); }}
                onKeyDown={handleInputKeyDown}
              />
              {searchValue && (
                <button 
                    type="button" 
                    onClick={() => setSearchValue('')}
                    className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                    <Icon name="close" className="text-sm" />
                </button>
              )}
            </form>

            {/* Search Suggestions Panel (New Design) */}
            {showSuggestions && (
              <div 
                  ref={suggestionsRef} 
                  className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 animate-fadeIn origin-top p-4"
                  onKeyDown={handlePanelKeyDown}
              >
                 {/* History Section */}
                 {searchHistory.length > 0 && (
                     <div className="mb-4">
                         <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2 px-1">
                             <span className="font-bold flex items-center gap-1"><Icon name="history" className="text-xs"/>搜索历史</span>
                             <button onClick={clearHistory} className="hover:text-red-500 p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"><Icon name="delete" className="text-xs" /></button>
                         </div>
                         <div className="flex flex-wrap gap-2">
                             {searchHistory.map((item, idx) => (
                                 <button
                                     key={`hist-${idx}`}
                                     onClick={() => handleSuggestionClick(item)}
                                     className="search-tag px-3 py-1.5 bg-gray-100 dark:bg-slate-700 hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-600 dark:hover:text-blue-400 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition-colors truncate max-w-[150px] outline-none focus:ring-2 focus:ring-blue-500"
                                 >
                                     {item}
                                 </button>
                             ))}
                         </div>
                     </div>
                 )}
                 
                 {/* Hot Search Section */}
                 <div>
                     <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-2 px-1 space-x-1">
                         <Icon name="whatshot" className="text-xs text-red-500" />
                         <span className="font-bold">热门搜索</span>
                     </div>
                     <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                         {hotSearchList.slice(0, 12).map((item, idx) => (
                             <button
                                 key={`hot-${idx}`}
                                 onClick={() => handleSuggestionClick(item)}
                                 className="search-tag px-2 py-2 bg-gray-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-300 text-xs rounded-lg transition-colors truncate text-left flex items-center group outline-none focus:ring-2 focus:ring-blue-500 focus:bg-blue-50 dark:focus:bg-blue-900/30"
                             >
                                 <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] mr-2 font-bold flex-shrink-0 ${idx < 3 ? 'bg-red-500 text-white' : 'bg-gray-200 dark:bg-slate-600 text-gray-500 dark:text-gray-400'}`}>
                                     {idx + 1}
                                 </span>
                                 <span className="group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">{item}</span>
                             </button>
                         ))}
                         {hotSearchList.length === 0 && (
                            <div className="col-span-full text-center text-gray-400 text-xs py-2">
                                加载中...
                            </div>
                         )}
                     </div>
                 </div>
              </div>
            )}
          </div>

          {/* Actions Section */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {currentView !== 'HOME' && (
              <button 
                type="button"
                className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                onClick={onBack}
                title="返回上一页"
              >
                <Icon name="arrow_back" className="text-lg sm:text-xl" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
