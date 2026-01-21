
import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { Movie, SearchProps } from '../types';
import MovieCard from '../components/MovieCard';
import { searchVideos } from '../utils/api';
import { addToHistory } from '../utils/storage';
import { Icon } from '../components/Icon';

const Search: React.FC<SearchProps> = ({ 
    setView, 
    query, 
    onSelectMovie, 
    currentSource, 
    sources, 
    onSourceChange,
    savedState,
    onStateUpdate
}) => {
  const abortControllerRef = useRef<AbortController | null>(null);

  // 本地筛选排序状态
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc'); // default: year descending
  const [showYearMenu, setShowYearMenu] = useState(false);

  // 恢复滚动位置
  useLayoutEffect(() => {
    if (!savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (savedState.loading) {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading]);

  // 计算是否全选
  const isAllSelected = useMemo(() => {
      return sources.length > 0 && sources.every(s => savedState.selectedSourceApis.has(s.api));
  }, [sources, savedState.selectedSourceApis]);

  // 搜索主逻辑
  useEffect(() => {
    if (!query) return;
    if (query === savedState.query && savedState.hasSearched && !savedState.loading) return;

    const doSearch = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      onStateUpdate({ loading: true, query: query });

      const targetApis = savedState.isAggregate 
        ? Array.from(savedState.selectedSourceApis)
        : [currentSource.api];

      if (targetApis.length === 0) {
          onStateUpdate({ loading: false, results: [], hasSearched: true });
          return;
      }

      try {
        const searchTasks = sources
            .filter(s => targetApis.includes(s.api))
            .map(async (source) => {
                try {
                    const data = await searchVideos(source.api, query, signal);
                    return (data || []).filter(m => m && m.title).map(m => ({
                        ...m,
                        sourceApi: source.api,
                        sourceName: source.name
                    }));
                } catch (e: any) {
                    if (e.name === 'AbortError') throw e;
                    return [];
                }
            });

        const taskResults = await Promise.allSettled(searchTasks);
        if (signal.aborted) return;

        const flatResults: Movie[] = [];
        taskResults.forEach(result => {
            if (result.status === 'fulfilled') {
                flatResults.push(...result.value);
            }
        });

        // 核心聚合逻辑：按照 (Title + Year) 聚合，并收集所有源
        const resultGroup = new Map<string, Movie>();
        flatResults.forEach(item => {
            const titleKey = (item.title || '').trim().toLowerCase();
            const fullKey = titleKey; 
            
            if (resultGroup.has(fullKey)) {
                const existing = resultGroup.get(fullKey)!;
                if (!existing.availableSources) {
                    existing.availableSources = [{ api: existing.sourceApi!, name: existing.sourceName!, vodId: existing.id }];
                }
                if (item.sourceApi && item.sourceName) {
                    if (!existing.availableSources.some(s => s.api === item.sourceApi)) {
                        existing.availableSources.push({ api: item.sourceApi, name: item.sourceName, vodId: item.id });
                    }
                }
                if (!existing.year && item.year) existing.year = item.year;
                if ((!existing.image || existing.image.length < 10) && item.image) existing.image = item.image;
            } else {
                item.availableSources = [{ api: item.sourceApi!, name: item.sourceName!, vodId: item.id }];
                resultGroup.set(fullKey, item);
            }
        });
        
        onStateUpdate({ 
            results: Array.from(resultGroup.values()), 
            loading: false, 
            hasSearched: true 
        });
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("Search error:", error);
          onStateUpdate({ loading: false, hasSearched: true });
        }
      }
    };

    const timer = setTimeout(doSearch, 300);
    return () => {
        clearTimeout(timer);
        if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [query, currentSource.api, savedState.isAggregate, savedState.selectedSourceApis]);

  // 计算可用的年份列表
  const availableYears = useMemo(() => {
      const years = new Set<string>();
      savedState.results.forEach(m => {
          if (m.year && m.year.length === 4) years.add(m.year);
      });
      return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
  }, [savedState.results]);

  // 执行筛选和排序
  const displayMovies = useMemo(() => {
      let filtered = savedState.results;
      
      if (yearFilter !== 'all') {
          if (yearFilter === 'unknown') {
              filtered = filtered.filter(m => !m.year || m.year.length !== 4);
          } else {
              filtered = filtered.filter(m => m.year === yearFilter);
          }
      }

      return [...filtered].sort((a, b) => {
          const yearA = parseInt(a.year) || 0;
          const yearB = parseInt(b.year) || 0;
          if (sortOrder === 'desc') return yearB - yearA;
          else return yearA - yearB;
      });
  }, [savedState.results, yearFilter, sortOrder]);

  const handleMovieClick = (movie: Movie) => {
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const targetSource = sources.find(s => s.api === movie.sourceApi);
        if (targetSource) onSourceChange(targetSource);
    }
    addToHistory(movie);
    onSelectMovie(movie);
    setView('PLAYER');
  };

  // 切换单个源
  const toggleSourceSelection = (api: string) => {
    // 检查当前是否为全选状态
    const totalSources = sources.length;
    const currentSelectedCount = savedState.selectedSourceApis.size;
    const isCurrentlyAllSelected = totalSources > 0 && currentSelectedCount === totalSources;

    let newSet: Set<string>;

    if (isCurrentlyAllSelected) {
        // 如果当前是全选状态，点击某个源 -> 变成只选中这一个源 (取消其他的)
        newSet = new Set([api]);
    } else {
        // 正常切换逻辑
        newSet = new Set(savedState.selectedSourceApis);
        if (newSet.has(api)) {
            newSet.delete(api);
        } else {
            newSet.add(api);
        }
    }
    
    // 更新状态，hasSearched 置为 false 或保持不变由 useEffect 触发搜索更新
    onStateUpdate({ selectedSourceApis: newSet, hasSearched: false, isAggregate: true });
  };

  // 切换全选状态
  const toggleAllSources = () => {
    if (isAllSelected) {
        // 已全选 -> 清空选择
        onStateUpdate({ selectedSourceApis: new Set(), hasSearched: false, isAggregate: true });
    } else {
        // 未全选 -> 全选
        onStateUpdate({ 
            selectedSourceApis: new Set(sources.map(s => s.api)), 
            hasSearched: false,
            isAggregate: true 
        });
    }
  };

  const toggleAggregateMode = () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      onStateUpdate({ isAggregate: !savedState.isAggregate, hasSearched: false });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      <section className="space-y-4">
        {/* 顶部标题与聚合开关 */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    搜索结果 <span className="text-lg font-normal text-gray-500">{savedState.results.length > 0 ? `${savedState.results.length}条` : ''}</span>
                </h2>
            </div>
             <div className="flex items-center gap-4">
                <button 
                    onClick={toggleAggregateMode}
                    className={`flex items-center gap-2 px-6 py-2 rounded-full border transition-all text-xs font-bold shadow-sm ${savedState.isAggregate ? 'bg-blue-600 border-blue-600 text-white shadow-blue-500/20' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                    <Icon name={savedState.isAggregate ? "layers" : "layers_clear"} className="text-base" />
                    聚合搜索: {savedState.isAggregate ? '开启' : '关闭'}
                </button>
             </div>
        </div>
        
        {/* 筛选与排序工具栏 */}
        {savedState.hasSearched && !savedState.loading && savedState.results.length > 0 && (
             <div className="flex flex-wrap items-center gap-6 py-2">
                 {/* 来源筛选 (如果开启了聚合) */}
                 <div className="relative group">
                     <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-white transition-colors py-2">
                         来源 <Icon name="expand_more" className="text-sm" />
                     </button>
                     {/* 来源下拉 */}
                     <div className="absolute top-full left-0 pt-2 w-64 z-20 hidden group-hover:block">
                        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-xl">
                            <div className="text-xs text-gray-400 mb-2 flex justify-between items-center">
                                <span>已选中 {savedState.selectedSourceApis.size} 个源</span>
                            </div>
                            <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1">
                                {/* 全部 选项 */}
                                <div 
                                    onClick={toggleAllSources}
                                    className={`px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between ${isAllSelected ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                                >
                                    <span className="font-bold">全部</span>
                                    {isAllSelected && <Icon name="check" className="text-xs" />}
                                </div>
                                
                                <div className="h-px bg-gray-700 my-1 mx-1"></div>

                                {sources.map(s => (
                                    <div key={s.api} onClick={() => toggleSourceSelection(s.api)} className={`px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between ${savedState.selectedSourceApis.has(s.api) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                        <span className="truncate w-40">{s.name}</span>
                                        {savedState.selectedSourceApis.has(s.api) && <Icon name="check" className="text-xs" />}
                                    </div>
                                ))}
                            </div>
                        </div>
                     </div>
                 </div>

                 {/* 年份筛选 */}
                 <div className="relative z-20" onMouseEnter={() => setShowYearMenu(true)} onMouseLeave={() => setShowYearMenu(false)}>
                     <button className={`flex items-center gap-1 text-sm transition-colors py-2 ${yearFilter !== 'all' ? 'text-green-500 font-bold' : 'text-gray-500 hover:text-white'}`}>
                         {yearFilter === 'all' ? '年份' : yearFilter === 'unknown' ? '未知年份' : yearFilter} 
                         <Icon name="expand_more" className="text-sm" />
                     </button>
                     
                     {showYearMenu && (
                         <div className="absolute top-full left-0 pt-2 w-[420px] animate-fadeIn origin-top-left">
                             <div className="bg-[#1a1d26] border border-gray-700 rounded-xl p-4 shadow-2xl grid grid-cols-6 gap-2">
                                <button 
                                    onClick={() => { setYearFilter('all'); setShowYearMenu(false); }}
                                    className={`col-span-1 px-1 py-1.5 rounded text-[11px] text-center border transition-all ${yearFilter === 'all' ? 'bg-green-600 border-green-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800'}`}
                                >
                                    全部
                                </button>
                                {availableYears.map(y => (
                                    <button 
                                        key={y}
                                        onClick={() => { setYearFilter(y); setShowYearMenu(false); }}
                                        className={`col-span-1 px-1 py-1.5 rounded text-[11px] text-center border transition-all ${yearFilter === y ? 'bg-green-600 border-green-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800'}`}
                                    >
                                        {y}
                                    </button>
                                ))}
                                <button 
                                    onClick={() => { setYearFilter('unknown'); setShowYearMenu(false); }}
                                    className={`col-span-1 px-1 py-1.5 rounded text-[11px] text-center border transition-all ${yearFilter === 'unknown' ? 'bg-green-600 border-green-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800'}`}
                                >
                                    未知
                                </button>
                             </div>
                         </div>
                     )}
                 </div>

                 {/* 年份排序 */}
                 <button 
                    onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                    className="flex items-center gap-1 text-sm text-green-500 hover:text-green-400 transition-colors ml-2"
                 >
                     年份 <Icon name={sortOrder === 'desc' ? "arrow_downward" : "arrow_upward"} className="text-sm font-bold" />
                 </button>
             </div>
        )}
      </section>

      <section className="min-h-[60vh]">
         {savedState.loading ? (
             <div className="flex flex-col justify-center items-center py-32 space-y-6">
                <div className="relative">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500/20 border-t-blue-500 shadow-inner"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Icon name="travel_explore" className="text-blue-500 animate-pulse" />
                    </div>
                </div>
                <div className="text-center space-y-2">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">采集引擎工作中...</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic">正在从 {savedState.isAggregate ? (savedState.selectedSourceApis.size || sources.length) : '1'} 个线路采集数据，请稍后...</p>
                </div>
             </div>
         ) : (
            <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-y-10 gap-x-4 sm:gap-x-6">
                    {displayMovies.map((movie, index) => (
                        <MovieCard key={`${movie.sourceApi}-${movie.id}-${index}`} movie={movie} viewType="SEARCH" onClick={handleMovieClick} />
                    ))}
                </div>
                
                {displayMovies.length === 0 && savedState.hasSearched && (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="w-24 h-24 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 border border-gray-200 dark:border-gray-700">
                            <Icon name="search_off" className="text-5xl text-gray-300" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">未找到相关资源</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">尝试更换关键词，或者在上方开启“聚合搜索”并勾选更多线路。</p>
                        {!savedState.isAggregate && (
                            <button onClick={toggleAggregateMode} className="mt-8 px-8 py-3 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-700 transition-all shadow-lg active:scale-95">开启全网检索</button>
                        )}
                    </div>
                )}
            </>
         )}
      </section>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #334155;
        }
      `}</style>
    </main>
  );
};

export default Search;
