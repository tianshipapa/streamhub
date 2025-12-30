
import { Movie, Source } from '../types';

const HISTORY_KEY = 'streamhub_watch_history';
const FAVORITES_KEY = 'streamhub_favorites';
const CUSTOM_SOURCES_KEY = 'streamhub_custom_sources';
const CUSTOM_DOUBAN_TAGS_KEY = 'streamhub_custom_douban_tags';
const LAST_SOURCE_KEY = 'streamhub_last_source_api';
const MAX_HISTORY_ITEMS = 50;

// --- History Management ---

export const getHistory = (): Movie[] => {
  try {
    const historyJSON = localStorage.getItem(HISTORY_KEY);
    if (!historyJSON) return [];
    const parsed = JSON.parse(historyJSON);
    return Array.isArray(parsed) ? parsed.filter((item: any) => item && item.id && item.title) : [];
  } catch (error) {
    return [];
  }
};

export const getMovieHistory = (id: string): Movie | undefined => {
  const history = getHistory();
  return history.find(m => m.id === id);
};

export const addToHistory = (movie: Movie): void => {
  try {
    const history = getHistory();
    const existingIndex = history.findIndex((item) => item.id === movie.id);
    
    // 基础对象
    let newItem = { ...movie };
    
    if (existingIndex !== -1) {
        const existing = history[existingIndex];
        // 关键修复：合并进度。优先使用传入对象的进度（如果有），否则保留旧进度
        newItem.currentTime = movie.currentTime || existing.currentTime || 0;
        newItem.currentEpisodeUrl = movie.currentEpisodeUrl || existing.currentEpisodeUrl;
        newItem.currentEpisodeName = movie.currentEpisodeName || existing.currentEpisodeName;
        // 移除旧项
        history.splice(existingIndex, 1);
    }
    
    const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
  } catch (error) {}
};

export const updateHistoryProgress = (movieId: string, time: number, episodeUrl?: string, episodeName?: string): void => {
  try {
    const history = getHistory();
    const index = history.findIndex(m => m.id === movieId);
    if (index !== -1) {
      history[index].currentTime = time;
      if (episodeUrl) history[index].currentEpisodeUrl = episodeUrl;
      if (episodeName) history[index].currentEpisodeName = episodeName;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
  } catch (error) {}
};

export const removeFromHistory = (movieId: string): void => {
  const history = getHistory();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.filter(m => m.id !== movieId)));
};

export const clearHistory = (): void => localStorage.removeItem(HISTORY_KEY);

// --- Favorites Management ---

export const getFavorites = (): Movie[] => {
  try {
    const favJSON = localStorage.getItem(FAVORITES_KEY);
    if (!favJSON) return [];
    return JSON.parse(favJSON);
  } catch (e) { return []; }
};

export const isFavorite = (id: string): boolean => {
  const favorites = getFavorites();
  return favorites.some(m => m.id === id);
};

export const toggleFavorite = (movie: Movie): boolean => {
  const favorites = getFavorites();
  const index = favorites.findIndex(m => m.id === movie.id);
  let isAdded = false;
  if (index !== -1) {
    favorites.splice(index, 1);
    isAdded = false;
  } else {
    favorites.unshift(movie);
    isAdded = true;
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  return isAdded;
};

export const removeFromFavorites = (id: string): void => {
  const favorites = getFavorites();
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.filter(m => m.id !== id)));
};

export const clearFavorites = (): void => localStorage.removeItem(FAVORITES_KEY);

// --- Custom Source Management ---

export const getCustomSources = (): Source[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_SOURCES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) { return []; }
};

export const addCustomSourceToStorage = (source: Source): Source[] => {
  const current = getCustomSources();
  if (current.some(s => s.api === source.api)) return current;
  const updated = [...current, { ...source, isCustom: true }];
  localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
  return updated;
};

export const removeCustomSourceFromStorage = (api: string): Source[] => {
  const current = getCustomSources();
  const updated = current.filter(s => s.api !== api);
  localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
  return updated;
};

// --- Douban Tags ---

export const getCustomDoubanTags = (type: 'movie' | 'tv'): string[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
    if (!stored) return [];
    const allTags = JSON.parse(stored);
    return allTags[type] || [];
  } catch (e) { return []; }
};

export const addCustomDoubanTagToStorage = (type: 'movie' | 'tv', tag: string): string[] => {
  const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
  const allTags = stored ? JSON.parse(stored) : { movie: [], tv: [] };
  if (!allTags[type].includes(tag)) {
    allTags[type].push(tag);
    localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(allTags));
  }
  return allTags[type];
};

export const removeCustomDoubanTagFromStorage = (type: 'movie' | 'tv', tag: string): string[] => {
  const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
  if (!stored) return [];
  const allTags = JSON.parse(stored);
  allTags[type] = (allTags[type] || []).filter((t: string) => t !== tag);
  localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(allTags));
  return allTags[type];
};

export const getLastUsedSourceApi = (): string | null => localStorage.getItem(LAST_SOURCE_KEY);
export const setLastUsedSourceApi = (api: string): void => localStorage.setItem(LAST_SOURCE_KEY, api);
