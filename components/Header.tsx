

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
        // 静默失败，保持空列表或仅显示历史
      }
    };
    fetchHotWords();
  }, []);

  // 点击外部关闭建议框 (作为 onMouseLeave 的补充兜底)
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
      onSearch(searchValue.trim()); // App.tsx 默认会开启聚合搜索
      setView('SEARCH');
      setShowSuggestions(false);
      // 失焦
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
  };

  // 计算显示的列表：历史记录 + 热搜 (去重)
  // 不进行输入联想/自动补齐，仅作为推荐列表
  const displayList = useMemo(() => {
      const history = searchHistory.slice(0, 5);
      // 过滤掉已经在历史记录中的热词
      const hot = hotSearchList.filter(t => !history.includes(t)).slice(0, 15);
      return [...history, ...hot];
  }, [searchHistory, hotSearchList]);

  return (
    <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2 sm:gap-4">
          
          {/* Logo Section */}
          <div 
            className="flex-shrink-0 flex items-center cursor-pointer group"
            onClick={() => setView('HOME')}
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
            onMouseLeave={() => setShowSuggestions(false)} // 鼠标移开后热词消失
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
                onFocus={() => setShowSuggestions(true)}
                onClick={() => setShowSuggestions(true)} // 点击搜索框显示热词
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

            {/* Search Suggestions Dropdown */}
            {/* 修复：移除 !searchValue.trim() 条件，允许在输入框有内容时（如再次点击）仍然显示热词面板 */}
            {showSuggestions && displayList.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 animate-fadeIn origin-top">
                 {searchHistory.length > 0 && (
                     <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-slate-900/50 text-[10px] text-gray-500 border-b border-gray-100 dark:border-gray-700">
                         <span>历史记录</span>
                         <button onClick={clearHistory} className="hover:text-red-500 flex items-center gap-1"><Icon name="delete" className="text-xs" />清空</button>
                     </div>
                 )}
                 <div className="py-1">
                     {displayList.map((item, idx) => (
                         <div 
                            key={idx}
                            onClick={() => handleSuggestionClick(item)}
                            className="px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200 transition-colors"
                         >
                            <Icon name={searchHistory.includes(item) ? "history" : "whatshot"} className={searchHistory.includes(item) ? "text-gray-400 text-base" : "text-red-500 text-base"} />
                            <span>{item}</span>
                         </div>
                     ))}
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
