import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source, HomeViewState, SearchViewState } from './types';
import { fetchSources } from './utils/api';
import { getCustomSources, addCustomSourceToStorage, removeCustomSourceFromStorage } from './utils/storage';

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
    error: false
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

  // Theme state initialization
  const [isDark, setIsDark] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const savedTheme = localStorage.getItem('streamhub_theme');
        if (savedTheme) {
          return savedTheme === 'dark';
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      return false;
    } catch (e) {
      return false;
    }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState<string>('');
  
  // Source Management
  const [defaultSources, setDefaultSources] = useState<Source[]>([]);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [currentSource, setCurrentSource] = useState<Source>({ name: '加载中...', api: '' });

  // Computed combined sources
  const sources = [...defaultSources, ...customSources];

  // Sync theme
  useEffect(() => {
    try {
        const root = document.documentElement;
        if (isDark) {
            root.classList.add('dark');
            localStorage.setItem('streamhub_theme', 'dark');
        } else {
            root.classList.remove('dark');
            localStorage.setItem('streamhub_theme', 'light');
        }
    } catch (e) {
        console.error("Theme Error", e);
    }
  }, [isDark]);

  // Load sources
  useEffect(() => {
    const initSources = async () => {
        // 1. Fetch Default Sources
        const fetchedSources = await fetchSources();
        setDefaultSources(fetchedSources);

        // 2. Load Custom Sources
        const localCustomSources = getCustomSources();
        setCustomSources(localCustomSources);

        // 3. Set Initial Source
        if (localCustomSources.length > 0) {
           setCurrentSource(localCustomSources[0]);
        } else if (fetchedSources.length > 0) {
            setCurrentSource(fetchedSources[0]);
        }
    };
    initSources();
  }, []);

  // Update view wrapper to save scroll position before switching
  const handleViewChange = (newView: ViewState) => {
    // 1. Save state of current view before leaving
    if (currentView === 'HOME') {
        setHomeViewState(prev => ({ ...prev, scrollY: window.scrollY }));
    } else if (currentView === 'SEARCH') {
        setSearchViewState(prev => ({ ...prev, scrollY: window.scrollY }));
    }

    // 2. Track history for Player return
    if (newView === 'PLAYER') {
        setPreviousView(currentView);
    }

    // 3. Switch view
    setCurrentView(newView);
  };

  const handleBack = useCallback(() => {
    if (currentView === 'PLAYER') {
        setCurrentView(previousView);
    } else if (currentView === 'SEARCH') {
        setCurrentView('HOME');
    }
  }, [currentView, previousView]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    // Also update search state query
    setSearchViewState(prev => ({ ...prev, query: query, hasSearched: false }));
  };

  const handleSelectMovie = (id: string) => {
    setSelectedMovieId(id);
  };

  const handleAddCustomSource = (name: string, api: string) => {
    const newSource = { name, api, isCustom: true };
    const updated = addCustomSourceToStorage(newSource);
    setCustomSources(updated);
    setCurrentSource(newSource);
  };

  const handleRemoveCustomSource = (api: string) => {
    const updated = removeCustomSourceFromStorage(api);
    setCustomSources(updated);
    if (currentSource.api === api) {
        if (updated.length > 0) setCurrentSource(updated[0]);
        else if (defaultSources.length > 0) setCurrentSource(defaultSources[0]);
    }
  };

  // State update helpers for children
  const updateHomeState = (updates: Partial<HomeViewState>) => {
      setHomeViewState(prev => ({ ...prev, ...updates }));
  };

  const updateSearchState = (updates: Partial<SearchViewState>) => {
      setSearchViewState(prev => ({ ...prev, ...updates }));
  };

  const renderView = () => {
    switch (currentView) {
      case 'HOME':
        return (
          <Home 
            setView={handleViewChange} 
            onSelectMovie={handleSelectMovie} 
            currentSource={currentSource}
            sources={sources}
            onSourceChange={setCurrentSource}
            onAddCustomSource={handleAddCustomSource}
            onRemoveCustomSource={handleRemoveCustomSource}
            savedState={homeViewState}
            onStateUpdate={updateHomeState}
          />
        );
      case 'SEARCH':
        return (
            <Search 
                setView={handleViewChange} 
                query={searchQuery} 
                onSelectMovie={handleSelectMovie}
                currentSource={currentSource}
                sources={sources}
                onSourceChange={setCurrentSource}
                savedState={searchViewState}
                onStateUpdate={updateSearchState}
            />
        );
      case 'PLAYER':
        return (
            <Player 
                setView={handleViewChange} 
                movieId={selectedMovieId} 
                currentSource={currentSource}
            />
        );
      default:
        return (
            <Home 
                setView={handleViewChange} 
                onSelectMovie={handleSelectMovie} 
                currentSource={currentSource}
                sources={sources}
                onSourceChange={setCurrentSource}
                onAddCustomSource={handleAddCustomSource}
                onRemoveCustomSource={handleRemoveCustomSource}
                savedState={homeViewState}
                onStateUpdate={updateHomeState}
            />
        );
    }
  };

  return (
    <div className="flex flex-col min-h-screen font-display">
      <Header 
        currentView={currentView} 
        setView={handleViewChange} 
        onBack={handleBack}
        onSearch={handleSearch}
      />
      
      {renderView()}

      <Footer currentView={currentView} />
    </div>
  );
};

export default App;