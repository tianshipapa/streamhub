
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source, HomeViewState, SearchViewState, Movie } from './types';
import { fetchSources } from './utils/api';
import { getCustomSources, addCustomSourceToStorage, removeCustomSourceFromStorage, getLastUsedSourceApi, setLastUsedSourceApi } from './utils/storage';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('HOME');
  const [previousView, setPreviousView] = useState<ViewState>('HOME');
  
  // --- Persistent View States ---
  const [homeViewState, setHomeViewState] = useState<HomeViewState>({
    movies: [],
    categories: [],
    activeCategoryId: '',
    page: 1,
    scrollY: 0,
    sourceApi: '',
    loading: true,
    error: false,
    isDoubanMode: false,
    doubanType: 'movie',
    doubanTag: '热门',
    doubanMovies: []
  });

  const [searchViewState, setSearchViewState] = useState<SearchViewState>({
    results: [],
    query: '',
    scrollY: 0,
    isAggregate: false,
    selectedSourceApis: new Set(),
    loading: false,
    hasSearched: false
  });

  const [isDark, setIsDark] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const savedTheme = localStorage.getItem('streamhub_theme');
        if (savedTheme) return savedTheme === 'dark';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      return false;
    } catch (e) { return false; }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState<string>('');
  
  // Source Management
  const [defaultSources, setDefaultSources] = useState<Source[]>([]);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [currentSource, setCurrentSource] = useState<Source>({ name: '加载中...', api: '' });
  
  // 专门用于播放页面的源状态，防止切源污染全局 Home 状态
  const [playbackSource, setPlaybackSource] = useState<Source | null>(null);

  const sources = useMemo(() => [...defaultSources, ...customSources], [defaultSources, customSources]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
        root.classList.add('dark');
        localStorage.setItem('streamhub_theme', 'dark');
    } else {
        root.classList.remove('dark');
        localStorage.setItem('streamhub_theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    const initSources = async () => {
        const fetchedSources = await fetchSources();
        setDefaultSources(fetchedSources);
        const localCustomSources = getCustomSources();
        setCustomSources(localCustomSources);
        
        const lastApi = getLastUsedSourceApi();
        const allSources = [...fetchedSources, ...localCustomSources];
        
        const savedSource = lastApi ? allSources.find(s => s.api === lastApi) : null;

        if (savedSource) {
           setCurrentSource(savedSource);
        } else if (allSources.length > 0) {
            setCurrentSource(allSources[0]);
            setLastUsedSourceApi(allSources[0].api);
        }
    };
    initSources();
  }, []);

  const handleSourceChange = (source: Source) => {
    setCurrentSource(source);
    setLastUsedSourceApi(source.api);
    // 同时也重置播放源，确保一致性
    setPlaybackSource(source);
  };

  const handleViewChange = (newView: ViewState) => {
    if (currentView === 'HOME') {
        setHomeViewState(prev => ({ ...prev, scrollY: window.scrollY }));
    } else if (currentView === 'SEARCH') {
        setSearchViewState(prev => ({ ...prev, scrollY: window.scrollY }));
    }
    if (newView === 'PLAYER') setPreviousView(currentView);
    setCurrentView(newView);
  };

  const handleBack = useCallback(() => {
    if (currentView === 'PLAYER') setCurrentView(previousView);
    else if (currentView === 'SEARCH') setCurrentView('HOME');
  }, [currentView, previousView]);

  const handleSearch = (query: string, autoAggregate: boolean = false) => {
    setSearchQuery(query);
    setSearchViewState(prev => {
        const next = { 
            ...prev, 
            query: query, 
            hasSearched: false,
            isAggregate: autoAggregate || prev.isAggregate,
            selectedSourceApis: new Set(prev.selectedSourceApis)
        };
        
        const currentAvailableApis = sources.map(s => s.api);
        
        if (autoAggregate) {
            next.selectedSourceApis = new Set(currentAvailableApis);
        } else if (next.selectedSourceApis.size === 0) {
            next.selectedSourceApis = new Set([currentSource.api]);
        }
        return next;
    });
    handleViewChange('SEARCH');
  };

  const handleSelectMovie = (movie: Movie) => {
    setSelectedMovieId(movie.id);
    
    // 找到该电影对应的源
    const targetSource = sources.find(s => s.api === movie.sourceApi) || 
                        (movie.sourceApi ? { name: movie.sourceName || '资源源', api: movie.sourceApi } : null);
    
    const activeSource = targetSource || currentSource;

    // 始终更新播放源
    setPlaybackSource(activeSource);

    /**
     * 关键逻辑修复：
     * 如果当前不是在播放页（即从主页或搜索页点击进入），则同步更新全局 currentSource。
     * 如果当前已经在播放页（即在播放页内部点击“全网切源”），则仅更新 playbackSource，
     * 不更新全局 currentSource。这样返回主页时，主页仍维持原有的线路和列表状态。
     */
    if (currentView !== 'PLAYER' && targetSource && targetSource.api !== currentSource.api) {
        setCurrentSource(targetSource);
        setLastUsedSourceApi(targetSource.api);
    }
  };

  const handleAddCustomSource = (name: string, api: string) => {
    const newSource = { name, api, isCustom: true };
    const updated = addCustomSourceToStorage(newSource);
    setCustomSources(updated);
    handleSourceChange(newSource);
  };

  const handleRemoveCustomSource = (api: string) => {
    const updated = removeCustomSourceFromStorage(api);
    setCustomSources(updated);
    if (currentSource.api === api) {
        if (updated.length > 0) handleSourceChange(updated[0]);
        else if (defaultSources.length > 0) handleSourceChange(defaultSources[0]);
    }
  };

  const updateHomeState = (updates: Partial<HomeViewState>) => setHomeViewState(prev => ({ ...prev, ...updates }));
  const updateSearchState = (updates: Partial<SearchViewState>) => setSearchViewState(prev => ({ ...prev, ...updates }));

  const renderView = () => {
    switch (currentView) {
      case 'HOME':
        return <Home setView={handleViewChange} onSelectMovie={handleSelectMovie} currentSource={currentSource} sources={sources} onSourceChange={handleSourceChange} onAddCustomSource={handleAddCustomSource} onRemoveCustomSource={handleRemoveCustomSource} onSearch={handleSearch} savedState={homeViewState} onStateUpdate={updateHomeState} />;
      case 'SEARCH':
        return <Search setView={handleViewChange} query={searchQuery} onSelectMovie={handleSelectMovie} currentSource={currentSource} sources={sources} onSourceChange={handleSourceChange} savedState={searchViewState} onStateUpdate={updateSearchState} />;
      case 'PLAYER':
        return <Player setView={handleViewChange} movieId={selectedMovieId} currentSource={playbackSource || currentSource} sources={sources} onSelectMovie={handleSelectMovie} />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen font-display">
      <Header currentView={currentView} setView={handleViewChange} onBack={handleBack} onSearch={handleSearch} />
      {renderView()}
      <Footer currentView={currentView} />
    </div>
  );
};

export default App;
