
export interface Movie {
  id: string;
  title: string;
  year: string;
  genre: string;
  image: string;
  badge?: string;
  badgeColor?: 'black' | 'primary';
  rating?: number;
  // Fields for API data
  vod_id?: string;
  vod_play_url?: string;
  vod_content?: string;
  vod_actor?: string;
  vod_director?: string;
  // User data
  currentTime?: number;
  currentEpisodeUrl?: string; 
  currentEpisodeName?: string; 
  // Aggregate Search Data
  sourceApi?: string;
  sourceName?: string;
  // Douban specific
  isDouban?: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export interface Source {
  name: string;
  api: string;
  isCustom?: boolean;
}

export type ViewState = 'HOME' | 'SEARCH' | 'PLAYER';

// --- State Persistence Interfaces ---

export interface HomeViewState {
  movies: Movie[];
  categories: Category[];
  activeCategoryId: string;
  page: number;
  scrollY: number;
  sourceApi: string; 
  loading: boolean;
  error: boolean;
  // Douban States
  isDoubanMode: boolean;
  doubanType: 'movie' | 'tv';
  doubanTag: string;
  doubanMovies: Movie[];
}

export interface SearchViewState {
  results: Movie[];
  query: string;
  scrollY: number;
  isAggregate: boolean;
  selectedSourceApis: Set<string>;
  loading: boolean;
  hasSearched: boolean; 
}

// --- Props Interfaces ---

export interface NavProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onBack: () => void;
  // Updated to support optional autoAggregate parameter
  onSearch: (query: string, autoAggregate?: boolean) => void;
}

export interface PlayerProps {
  setView: (view: ViewState) => void;
  movieId: string;
  currentSource: Source;
}

export interface SearchProps {
  setView: (view: ViewState) => void;
  query: string;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
  onSelectMovie: (movie: Movie) => void;
  savedState: SearchViewState;
  onStateUpdate: (updates: Partial<SearchViewState>) => void;
}

export interface HomeProps {
  setView: (view: ViewState) => void;
  onSelectMovie: (movie: Movie) => void;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
  onAddCustomSource: (name: string, api: string) => void;
  onRemoveCustomSource: (api: string) => void;
  // Updated to support optional autoAggregate parameter
  onSearch: (query: string, autoAggregate?: boolean) => void; // Added to trigger search from Home
  savedState: HomeViewState;
  onStateUpdate: (updates: Partial<HomeViewState>) => void;
}
