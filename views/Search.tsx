
import React, { useEffect, useLayoutEffect } from 'react';
import { Movie, SearchProps } from '../types';
import MovieCard from '../components/MovieCard';
import { searchVideos } from '../utils/api';
import { addToHistory } from '../utils/storage';

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
  // Initialize selected sources once
  useEffect(() => {
    if (sources.length > 0 && savedState.selectedSourceApis.size === 0) {
        onStateUpdate({ selectedSourceApis: new Set(sources.map(s => s.api)) });
    }
  }, [sources]);

  // Restore Scroll Position
  useLayoutEffect(() => {
    if (!savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (savedState.loading) {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading]);

  // Main search effect
  useEffect(() => {
    // If query matches what we have in state and we have results/searched, don't re-fetch
    if (!query) return;
    if (query === savedState.query && savedState.hasSearched) return;

    const doSearch = async () => {
      onStateUpdate({ loading: true, results: [], query: query });

      if (!savedState.isAggregate) {
        // Single Source Search
        if (!currentSource.api) {
            onStateUpdate({ loading: false });
            return;
        }
        const data = await searchVideos(currentSource.api, query);
        const enhancedData = data.map(m => ({
            ...m,
            sourceApi: currentSource.api,
            sourceName: currentSource.name
        }));
        onStateUpdate({ results: enhancedData, loading: false, hasSearched: true });
      } else {
        // Aggregate Search
        const searchPromises = sources
            .filter(s => savedState.selectedSourceApis.has(s.api))
            .map(async (source) => {
                try {
                    const data = await searchVideos(source.api, query);
                    return data.map(m => ({
                        ...m,
                        sourceApi: source.api,
                        sourceName: source.name
                    }));
                } catch (e) {
                    console.warn(`Search failed for ${source.name}`, e);
                    return [];
                }
            });

        const allResults = await Promise.all(searchPromises);
        onStateUpdate({ results: allResults.flat(), loading: false, hasSearched: true });
      }
    };

    // Debounce
    const timer = setTimeout(() => {
        doSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [query, currentSource, savedState.isAggregate, savedState.selectedSourceApis, sources, savedState.hasSearched, savedState.query]);

  const handleMovieClick = (movie: Movie) => {
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const targetSource = sources.find(s => s.api === movie.sourceApi);
        if (targetSource) {
            onSourceChange(targetSource);
        }
    }
    
    addToHistory(movie);
    onSelectMovie(movie); // Fixed: Pass the movie object instead of id string
    setView('PLAYER');
  };

  const toggleSourceSelection = (api: string) => {
    const newSet = new Set(savedState.selectedSourceApis);
    if (newSet.has(api)) {
        newSet.delete(api);
    } else {
        newSet.add(api);
    }
    onStateUpdate({ selectedSourceApis: newSet, hasSearched: false }); // Trigger re-search
  };

  const toggleAllSources = () => {
    if (savedState.selectedSourceApis.size === sources.length) {
        onStateUpdate({ selectedSourceApis: new Set(), hasSearched: false });
    } else {
        onStateUpdate({ selectedSourceApis: new Set(sources.map(s => s.api)), hasSearched: false });
    }
  };

  const setAggregate = (val: boolean) => {
      onStateUpdate({ isAggregate: val, hasSearched: false });
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      {/* Header Info & Controls */}
      <section className="space-y-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <h2 className="text-2xl font-bold text-gray-900 dark:text-white">搜索: "{query}"</h2>
             <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">聚合搜索</span>
                    <button 
                        onClick={() => setAggregate(!savedState.isAggregate)}
                        className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${savedState.isAggregate ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform duration-300 ${savedState.isAggregate ? 'translate-x-5' : 'translate-x-0'}`}></div>
                    </button>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    找到 {savedState.results.length} 个结果
                </div>
             </div>
          </div>

          {/* Aggregate Options Panel */}
          {savedState.isAggregate && (
              <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
                 <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-500 dark:text-gray-400">选择搜索源:</span>
                    <button 
                        onClick={toggleAllSources}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                        {savedState.selectedSourceApis.size === sources.length ? '取消全选' : '全选'}
                    </button>
                 </div>
                 <div className="flex flex-wrap gap-2">
                    {sources.map(source => (
                        <button
                            key={source.api}
                            onClick={() => toggleSourceSelection(source.api)}
                            className={`px-3 py-1.5 rounded-md text-xs transition-all border ${
                                savedState.selectedSourceApis.has(source.api) 
                                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-600 dark:text-blue-400 font-medium' 
                                : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                            }`}
                        >
                            {source.name}
                        </button>
                    ))}
                 </div>
              </div>
          )}
        </div>
      </section>

      {/* Results Grid */}
      <section className="min-h-[50vh]">
         {savedState.loading ? (
             <div className="flex flex-col justify-center items-center py-20 space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                {savedState.isAggregate && <p className="text-sm text-gray-500">正在搜索 {savedState.selectedSourceApis.size} 个资源站...</p>}
             </div>
         ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-8 gap-x-4 sm:gap-x-6">
                {savedState.results.map((movie, index) => (
                <MovieCard 
                    key={`${movie.sourceApi}-${movie.id}-${index}`} 
                    movie={movie} 
                    viewType="SEARCH" 
                    onClick={() => handleMovieClick(movie)} 
                />
                ))}
                {savedState.results.length === 0 && !savedState.loading && (
                    <div className="col-span-full text-center text-gray-500 dark:text-gray-400 py-10">
                        没有找到相关视频
                    </div>
                )}
            </div>
         )}
      </section>
    </main>
  );
};

export default Search;
