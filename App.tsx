
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source, HomeViewState, SearchViewState, Movie } from './types';
import { fetchSources } from './utils/api';
import { 
  getCustomSources, 
  addCustomSourceToStorage, 
  removeCustomSourceFromStorage, 
  updateAllCustomSources, 
  getLastUsedSourceApi, 
  setLastUsedSourceApi,
  getDisabledSourceApis,
  updateDisabledSourceApis,
  resetSourcesToDefault
} from './utils/storage';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('HOME');
  const [previousView, setPreviousView] = useState<ViewState>('HOME');
  
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
  
  const [defaultSources, setDefaultSources] = useState<Source[]>([]);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [disabledApis, setDisabledApis] = useState<Set<string>>(new Set());
  const [currentSource, setCurrentSource] = useState<Source>({ name: '加载中...', api: '' });
  
  const [playbackSource, setPlaybackSource] = useState<Source | null>(null);

  // 完整列表：用于管理和健康检测
  const allSources = useMemo(() => [...defaultSources, ...customSources], [defaultSources, customSources]);

  // 过滤后的可用列表：用于首页展示、搜索等
  const sources = useMemo(() => {
    return allSources.filter(s => !disabledApis.has(s.api));
  }, [allSources, disabledApis]);

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

  const initSources = useCallback(async () => {
    const fetchedSources = await fetchSources();
    setDefaultSources(fetchedSources);
    
    const localCustomSources = getCustomSources();
    setCustomSources(localCustomSources);
    
    const localDisabled = getDisabledSourceApis();
    setDisabledApis(new Set(localDisabled));
    
    const lastApi = getLastUsedSourceApi();
    const allWorkingSources = [...fetchedSources, ...localCustomSources].filter(s => !localDisabled.includes(s.api));
    
    const savedSource = lastApi ? allWorkingSources.find(s => s.api === lastApi) : null;

    if (savedSource) {
       setCurrentSource(savedSource);
    } else if (allWorkingSources.length > 0) {
        setCurrentSource(allWorkingSources[0]);
        setLastUsedSourceApi(allWorkingSources[0].api);
    }
  }, []);

  useEffect(() => {
    initSources();
  }, [initSources]);

  const handleSourceChange = (source: Source) => {
    setCurrentSource(source);
    setLastUsedSourceApi(source.api);
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
    const targetSource = sources.find(s => s.api === movie.sourceApi) || 
                        (movie.sourceApi ? { name: movie.sourceName || '资源源', api: movie.sourceApi } : null);
    const activeSource = targetSource || currentSource;
    setPlaybackSource(activeSource);

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

  const handleUpdateCustomSources = (newCustomSources: Source[]) => {
    updateAllCustomSources(newCustomSources);
    setCustomSources([...newCustomSources]);
    // 检查当前源是否还在可用列表中
    const currentStillAvailable = [...defaultSources, ...newCustomSources].some(s => s.api === currentSource.api && !disabledApis.has(s.api));
    if (!currentStillAvailable) {
      const firstAvailable = [...defaultSources, ...newCustomSources].find(s => !disabledApis.has(s.api));
      if (firstAvailable) handleSourceChange(firstAvailable);
    }
  };

  const handleUpdateDisabledSources = (newDisabledApisList: string[]) => {
    // 健康检测完成后，应以最新的检测结果为准（覆盖式更新）
    updateDisabledSourceApis(newDisabledApisList);
    setDisabledApis(new Set(newDisabledApisList));
    
    // 如果当前选中的源现在被禁用了，则重置为第一个可用的源
    if (newDisabledApisList.includes(currentSource.api)) {
      const availableSources = [...defaultSources, ...customSources].filter(s => !newDisabledApisList.includes(s.api));
      if (availableSources.length > 0) handleSourceChange(availableSources[0]);
    }
  };

  const handleResetSources = () => {
    if (confirm('确定要恢复默认设置吗？所有自定义源和健康检测记录都将被清除。')) {
      resetSourcesToDefault();
      setDisabledApis(new Set());
      setCustomSources([]);
      initSources();
      alert('已恢复为默认源配置');
    }
  };

  const updateHomeState = (updates: Partial<HomeViewState>) => setHomeViewState(prev => ({ ...prev, ...updates }));
  const updateSearchState = (updates: Partial<SearchViewState>) => setSearchViewState(prev => ({ ...prev, ...updates }));

  const renderView = () => {
    switch (currentView) {
      case 'HOME':
        return <Home 
          setView={handleViewChange} 
          onSelectMovie={handleSelectMovie} 
          currentSource={currentSource} 
          sources={sources} 
          // @ts-ignore: 我们传递一个额外的 allSources 给 Home 组件用于管理界面
          allSources={allSources}
          onSourceChange={handleSourceChange} 
          onAddCustomSource={handleAddCustomSource} 
          onRemoveCustomSource={handleRemoveCustomSource} 
          onUpdateCustomSources={handleUpdateCustomSources}
          onUpdateDisabledSources={handleUpdateDisabledSources}
          onResetSources={handleResetSources}
          onSearch={handleSearch} 
          savedState={homeViewState} 
          onStateUpdate={updateHomeState} 
        />;
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
