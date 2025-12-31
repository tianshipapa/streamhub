
import React, { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Movie, Category, HomeProps, Source } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';
import { fetchVideoList, fetchDoubanSubjects, fetchViaProxy } from '../utils/api';
import { 
  getHistory, 
  addToHistory, 
  clearHistory, 
  removeFromHistory,
  getFavorites,
  clearFavorites,
  removeFromFavorites,
  getCustomDoubanTags,
  addCustomDoubanTagToStorage,
  removeCustomDoubanTagFromStorage,
  exportSourcesData,
  importSourcesData,
  exportFullBackup,
  importFullBackup
} from '../utils/storage';

const ORIGINAL_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const ORIGINAL_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

interface MaintenanceStats {
    duplicates: number;
    dead: number;
    total: number;
    cleanedList: Source[];
    deadApis: string[];
}

interface ExtendedHomeProps extends HomeProps {
  allSources: Source[]; // 由 App 传递的完整列表
}

const Home: React.FC<ExtendedHomeProps> = ({ 
  setView, 
  onSelectMovie, 
  currentSource, 
  sources, 
  allSources, // 接收完整列表
  onSourceChange,
  onAddCustomSource,
  onRemoveCustomSource,
  onUpdateCustomSources,
  onUpdateDisabledSources,
  onResetSources,
  onSearch,
  savedState,
  onStateUpdate
}) => {
  const [history, setHistory] = useState<Movie[]>([]);
  const [favorites, setFavorites] = useState<Movie[]>([]);
  const [mode, setMode] = useState<'SOURCE' | 'DOUBAN' | 'FAVORITE' | 'SETTINGS'>(savedState.isDoubanMode ? 'DOUBAN' : 'SOURCE');
  
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearFav, setConfirmClearFav] = useState(false);
  
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceApi, setNewSourceApi] = useState('');

  const [customDoubanTags, setCustomDoubanTags] = useState<string[]>([]);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  // 健康检测相关状态
  const [isCheckingSources, setIsCheckingSources] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ current: 0, total: 0, name: '' });
  const [maintenanceStats, setMaintenanceStats] = useState<MaintenanceStats | null>(null);

  // 导入导出相关的状态
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [remoteSourceUrl, setRemoteSourceUrl] = useState('');
  const [remoteBackupUrl, setRemoteBackupUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'DOUBAN') {
      const tags = getCustomDoubanTags(savedState.doubanType);
      setCustomDoubanTags(tags);
      if (savedState.doubanMovies.length === 0) {
        loadDoubanData(savedState.doubanType, savedState.doubanTag, 0);
      }
    } else if (mode === 'SOURCE') {
      if (currentSource.api && (currentSource.api !== savedState.sourceApi || savedState.movies.length === 0)) {
        onStateUpdate({
            sourceApi: currentSource.api,
            movies: [],
            categories: [],
            activeCategoryId: '',
            page: 1,
            loading: true,
            error: false
        });
        loadData(currentSource.api, '', 1);
      }
    } else if (mode === 'FAVORITE') {
      setFavorites(getFavorites());
    }
    setHistory(getHistory());
  }, [currentSource.api, mode, savedState.doubanType, savedState.doubanTag]);

  useLayoutEffect(() => {
    if (mode === 'SOURCE' && !savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (mode !== 'FAVORITE' && mode !== 'SETTINGS') {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading, mode]);

  const loadData = async (apiUrl: string, typeId: string, pageNum: number) => {
    if (pageNum === 1) onStateUpdate({ loading: true, error: false });
    try {
        const { videos, categories: fetchedCategories } = await fetchVideoList(apiUrl, typeId, pageNum);
        const enhancedVideos = videos.map(v => ({ ...v, sourceApi: apiUrl, sourceName: currentSource.name }));
        const newMovies = pageNum === 1 ? enhancedVideos : [...savedState.movies, ...enhancedVideos];
        onStateUpdate({ 
            movies: newMovies, 
            categories: fetchedCategories.length > 0 ? fetchedCategories : savedState.categories,
            loading: false,
            page: pageNum,
            sourceApi: apiUrl
        });
    } catch (e) { onStateUpdate({ error: true, loading: false }); }
  };

  const loadDoubanData = async (type: 'movie' | 'tv', tag: string, start: number) => {
    onStateUpdate({ loading: true });
    try {
      const results = await fetchDoubanSubjects(type, tag, start);
      onStateUpdate({ doubanMovies: start === 0 ? results : [...savedState.doubanMovies, ...results], loading: false });
    } catch (e) { onStateUpdate({ loading: false, error: true }); }
  };

  const handleMovieClick = (movie: Movie) => {
    if (movie.isDouban) {
      onSearch(movie.title, true);
    } else {
      addToHistory(movie);
      onSelectMovie(movie);
      setView('PLAYER');
    }
  };

  const handleAddSourceSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (newSourceName.trim() && newSourceApi.trim()) {
          onAddCustomSource(newSourceName.trim(), newSourceApi.trim());
          setNewSourceName(''); setNewSourceApi(''); setShowAddSource(false);
          alert('源站添加成功');
      }
  };

  // 运行全量源站检测：包含内置源和自定义源（全量扫描，包括之前被禁用的）
  const runSourceCheck = async () => {
    if (isCheckingSources) return;
    setIsCheckingSources(true);
    setMaintenanceStats(null);
    
    // 使用 allSources 进行检测，这样可以发现“起死回生”的源
    const totalToMaintenace = allSources.length;
    if (totalToMaintenace === 0) {
        alert('当前没有源站可供检测');
        setIsCheckingSources(false);
        return;
    }

    setCheckProgress({ current: 0, total: totalToMaintenace, name: '准备开始全量扫描...' });

    const seenApis = new Set<string>();
    const workingSources: Source[] = [];
    const deadApis: string[] = [];
    let duplicatesCount = 0;
    let deadCount = 0;

    for (let i = 0; i < allSources.length; i++) {
        const s = allSources[i];
        setCheckProgress({ current: i + 1, total: totalToMaintenace, name: `正在检测: ${s.name}` });

        if (seenApis.has(s.api)) {
            duplicatesCount++;
            continue;
        }

        try {
            const separator = s.api.includes('?') ? '&' : '?';
            const testUrl = `${s.api}${separator}ac=list`;
            const result = await fetchViaProxy(testUrl);
            if (result && (result.includes('vod') || result.includes('list') || result.includes('class') || result.includes('code":200'))) {
                workingSources.push(s);
                seenApis.add(s.api);
            } else {
                deadCount++;
                deadApis.push(s.api);
            }
        } catch (err) {
            deadCount++;
            deadApis.push(s.api);
        }
    }

    setMaintenanceStats({
        duplicates: duplicatesCount,
        dead: deadCount,
        total: totalToMaintenace,
        cleanedList: workingSources,
        deadApis: deadApis
    });
    setIsCheckingSources(false);
  };

  // 确认清理：将优化后的源列表应用到项目
  const confirmCleanup = () => {
      if (!maintenanceStats) return;
      const totalToOptimize = maintenanceStats.duplicates + maintenanceStats.dead;
      
      if (totalToOptimize === 0) {
          // 如果全部健康，也要更新一次，因为可能修复了之前误报失效的源
          if (confirm('所有源站均处于健康状态！是否重置屏蔽列表以恢复所有线路？')) {
              onUpdateCustomSources(allSources.filter(s => s.isCustom));
              onUpdateDisabledSources([]);
              setMaintenanceStats(null);
          }
          return;
      }

      if (confirm(`检测完毕！\n- 发现重复源: ${maintenanceStats.duplicates} 个\n- 发现失效源: ${maintenanceStats.dead} 个\n\n是否确认清理并应用优化后的列表？\n(注：失效的内置源将被屏蔽，失效的自定义源将被移除)`)) {
          // 1. 处理自定义源：过滤出健康的自定义源
          const healthyCustomList = maintenanceStats.cleanedList.filter(s => s.isCustom);
          onUpdateCustomSources(healthyCustomList);
          
          // 2. 处理内置源屏蔽：找出不再健康的内置源 API
          const workingApis = new Set(maintenanceStats.cleanedList.map(s => s.api));
          // 从 allSources（完整列表）中计算出所有不健康的内置源
          const allDisabledApis = allSources
            .filter(s => !s.isCustom && !workingApis.has(s.api))
            .map(s => s.api);
          
          onUpdateDisabledSources(allDisabledApis);

          setMaintenanceStats(null);
          alert('清理完成，源列表已更新');
      }
  };

  const handleSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = JSON.parse(event.target?.result as string);
              importSourcesData(json);
              alert('源列表导入成功');
              window.location.reload();
          } catch (err) { alert('导入失败：无效的 JSON 文件'); }
      };
      reader.readAsText(file);
  };

  const handleRemoteSourceImport = async () => {
    if (!remoteSourceUrl.trim()) return;
    setIsImporting(true);
    try {
        const text = await fetchViaProxy(remoteSourceUrl.trim());
        const json = JSON.parse(text);
        importSourcesData(json);
        alert('远程源同步成功');
        window.location.reload();
    } catch (err) {
        alert('远程导入失败：请检查链接有效性或 JSON 格式');
    } finally {
        setIsImporting(false);
    }
  };

  const handleBackupUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = JSON.parse(event.target?.result as string);
              const success = importFullBackup(json);
              if (success) {
                  alert('全量数据还原成功，即将刷新页面');
                  window.location.reload();
              } else { alert('还原失败：数据结构不正确'); }
          } catch (err) { alert('还原失败：无效的 JSON 文件'); }
      };
      reader.readAsText(file);
  };

  const handleRemoteBackupImport = async () => {
    if (!remoteBackupUrl.trim()) return;
    setIsImporting(true);
    try {
        const text = await fetchViaProxy(remoteBackupUrl.trim());
        const json = JSON.parse(text);
        const success = importFullBackup(json);
        if (success) {
            alert('全量远程数据同步成功，即将刷新页面');
            window.location.reload();
        } else {
            alert('数据校验失败：非法的备份文件格式');
        }
    } catch (err) {
        alert('远程备份同步失败：请检查链接有效性');
    } finally {
        setIsImporting(false);
    }
  };

  const handleRemoveTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    const updated = removeCustomDoubanTagFromStorage(savedState.doubanType, tag);
    setCustomDoubanTags(updated);
    if (savedState.doubanTag === tag) {
      const defaultTag = savedState.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS[0] : ORIGINAL_TV_TAGS[0];
      onStateUpdate({ doubanTag: defaultTag, doubanMovies: [] });
    }
  };

  const handleClearFavs = () => {
    if (confirmClearFav) {
      clearFavorites();
      setFavorites([]);
      setConfirmClearFav(false);
    } else {
      setConfirmClearFav(true);
      setTimeout(() => setConfirmClearFav(false), 3000);
    }
  };

  const handleRemoveFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeFromFavorites(id);
    setFavorites(getFavorites());
  };

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
      const updated = addCustomDoubanTagToStorage(savedState.doubanType, newTagName.trim());
      setCustomDoubanTags(updated);
      setNewTagName('');
      setShowAddTag(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {}
  };

  const originalTags = savedState.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS : ORIGINAL_TV_TAGS;
  
  // 设置页面显示的源列表应基于 allSources（完整列表，包括被屏蔽的）
  const officialAll = allSources.filter(s => !s.isCustom);
  const customAll = allSources.filter(s => s.isCustom);

  return (
    <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full animate-fadeIn">
      
      {/* 顶部主切换栏 */}
      <section className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-300">
             <div className="flex bg-gray-100 dark:bg-slate-900/50 p-1 rounded-xl w-full sm:w-auto overflow-x-auto hide-scrollbar">
                <button 
                    onClick={() => { setMode('SOURCE'); onStateUpdate({ isDoubanMode: false }); }}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'SOURCE' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="dns" className="text-lg" />源站
                </button>
                <button 
                    onClick={() => { setMode('DOUBAN'); onStateUpdate({ isDoubanMode: true }); }}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'DOUBAN' ? 'bg-pink-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="auto_awesome" className="text-lg" />豆瓣
                </button>
                <button 
                    onClick={() => setMode('FAVORITE')}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'FAVORITE' ? 'bg-amber-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="bookmark" className="text-lg" />收藏
                </button>
                <button 
                    onClick={() => setMode('SETTINGS')}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'SETTINGS' ? 'bg-gray-800 text-white shadow-lg dark:bg-slate-100 dark:text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="settings" className="text-lg" />设置
                </button>
             </div>

             {mode === 'SOURCE' && (
                <div className="relative w-full sm:w-auto">
                   <button onClick={() => setIsSourceMenuOpen(!isSourceMenuOpen)} className="w-full flex items-center justify-between gap-3 bg-gray-50 dark:bg-slate-900 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-all cursor-pointer">
                      <div className="flex items-center gap-2"><Icon name="settings_input_component" className="text-blue-500" /><span className="truncate max-w-[120px]">{currentSource.name}</span></div>
                      <Icon name="expand_more" className={`transition-transform ${isSourceMenuOpen ? 'rotate-180' : ''}`} />
                   </button>
                   {isSourceMenuOpen && (
                      <><div className="fixed inset-0 z-10" onClick={() => setIsSourceMenuOpen(false)}></div><div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
                        <div className="max-h-96 overflow-y-auto custom-scrollbar">
                            <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 dark:bg-slate-900/50">推荐源站</div>
                            {/* 菜单中只显示“可用”的源 */}
                            {sources.filter(s => !s.isCustom).map((s, idx) => (
                                <button key={idx} onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50' : 'text-gray-700 dark:text-gray-200'}`}>
                                    <span className="truncate flex-1 mr-2">{s.name}</span>
                                    {currentSource.api === s.api && <Icon name="check" className="text-xs" />}
                                </button>
                            ))}
                            
                            {sources.filter(s => s.isCustom).length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 dark:bg-slate-900/50 border-t border-gray-100 dark:border-gray-700">自定义源站</div>
                                    {sources.filter(s => s.isCustom).map((s, idx) => (
                                        <button key={`custom-${idx}`} onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50 font-bold' : 'text-gray-700 dark:text-gray-200'}`}>
                                            <span className="truncate flex-1 mr-2">{s.name}</span>
                                            {currentSource.api === s.api && <Icon name="check" className="text-xs" />}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                        <button onClick={() => { setMode('SETTINGS'); setIsSourceMenuOpen(false); }} className="w-full py-3 text-[10px] font-bold text-gray-400 hover:bg-gray-50 border-t border-gray-100 flex items-center justify-center gap-2 uppercase tracking-wider">管理源站列表</button>
                      </div></>
                   )}
                </div>
             )}
          </div>
      </section>

      {/* 动态内容展示 */}
      {mode === 'SETTINGS' ? (
        <section className="min-h-[60vh] animate-fadeIn space-y-10 pb-20">
            <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-8 flex items-center gap-3">
                    <span className="w-1.5 h-6 rounded-full bg-gray-800 dark:bg-white"></span>系统设置
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* 采集源导入导出 */}
                    <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600">
                                <Icon name="source" className="text-2xl" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white">数据同步</h3>
                                <p className="text-xs text-gray-500 mt-1 text-balance">批量导入或导出您的自定义源</p>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={exportSourcesData} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-gray-100 dark:border-gray-700 group">
                                <Icon name="download" className="text-xl group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold">导出源站</span>
                            </button>
                            <button onClick={() => sourceFileRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-gray-100 dark:border-gray-700 group">
                                <Icon name="upload" className="text-xl group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold">导入本地</span>
                            </button>
                            <input type="file" ref={sourceFileRef} onChange={handleSourceUpload} accept=".json" className="hidden" />
                        </div>

                        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                            <div className="flex gap-2">
                                <input 
                                    type="url" 
                                    placeholder="输入远程源 JSON 链接..." 
                                    className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                                    value={remoteSourceUrl}
                                    onChange={(e) => setRemoteSourceUrl(e.target.value)}
                                />
                                <button 
                                    onClick={handleRemoteSourceImport}
                                    disabled={isImporting || !remoteSourceUrl}
                                    className={`px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold transition-all flex items-center gap-2 ${isImporting ? 'opacity-50' : 'hover:bg-blue-700 active:scale-95'}`}
                                >
                                    <Icon name={isImporting ? "sync" : "cloud_download"} className={`text-sm ${isImporting ? 'animate-spin' : ''}`} />
                                    {isImporting ? '中' : '网络导入'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 一键备份与还原 */}
                    <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-amber-600">
                                <Icon name="backup" className="text-2xl" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white">全量备份</h3>
                                <p className="text-xs text-gray-500 mt-1 text-balance">备份历史、收藏、源站等所有数据</p>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={exportFullBackup} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all border border-gray-100 dark:border-gray-700 group">
                                <Icon name="save" className="text-xl group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold">保存备份</span>
                            </button>
                            <button onClick={() => backupFileRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all border border-gray-100 dark:border-gray-700 group">
                                <Icon name="restore" className="text-xl group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold">从本地还原</span>
                            </button>
                            <input type="file" ref={backupFileRef} onChange={handleBackupUpload} accept=".json" className="hidden" />
                        </div>

                        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                            <div className="flex gap-2">
                                <input 
                                    type="url" 
                                    placeholder="输入全量备份 JSON 链接..." 
                                    className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-xs focus:ring-1 focus:ring-amber-500 outline-none dark:text-white"
                                    value={remoteBackupUrl}
                                    onChange={(e) => setRemoteBackupUrl(e.target.value)}
                                />
                                <button 
                                    onClick={handleRemoteBackupImport}
                                    disabled={isImporting || !remoteBackupUrl}
                                    className={`px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold transition-all flex items-center gap-2 ${isImporting ? 'opacity-50' : 'hover:bg-amber-700 active:scale-95'}`}
                                >
                                    <Icon name={isImporting ? "sync" : "cloud_sync"} className={`text-sm ${isImporting ? 'animate-spin' : ''}`} />
                                    {isImporting ? '中' : '远程还原'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 源列表管理板块 - 核心管理区 */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50 dark:bg-slate-900/50">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Icon name="list_alt" className="text-blue-500" />
                        源站管理列表
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-[10px] text-blue-600 font-bold">{allSources.length}</span>
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                        <button 
                            onClick={onResetSources}
                            className="px-4 py-2 rounded-xl text-xs font-bold text-red-500 border border-red-100 dark:border-red-900/30 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all flex items-center gap-2 active:scale-95"
                        >
                            <Icon name="restart_alt" className="text-sm" />恢复默认
                        </button>
                        <button 
                            onClick={runSourceCheck} 
                            disabled={isCheckingSources}
                            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border ${isCheckingSources ? 'bg-gray-100 text-gray-400' : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95'}`}
                        >
                            <Icon name={isCheckingSources ? "sync" : "health_and_safety"} className={isCheckingSources ? "animate-spin" : ""} />
                            {isCheckingSources ? '全量检测中...' : '健康检测'}
                        </button>
                        <button onClick={() => setShowAddSource(true)} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold flex items-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 active:scale-95">
                            <Icon name="add" className="text-sm" />手动添加
                        </button>
                    </div>
                </div>

                {/* 检测状态指示器与清理面板 */}
                {(isCheckingSources || maintenanceStats) && (
                    <div className="px-8 py-6 bg-blue-50/50 dark:bg-blue-900/5 border-b border-gray-100 dark:border-gray-700 animate-fadeIn">
                        {isCheckingSources ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-xs font-bold text-blue-600">
                                    <span className="truncate flex-1 mr-4">正在全量扫描 ({checkProgress.current}/{checkProgress.total}): {checkProgress.name}</span>
                                    <span>{Math.round((checkProgress.current / checkProgress.total) * 100)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-blue-600 transition-all duration-300 ease-out"
                                        style={{ width: `${(checkProgress.current / checkProgress.total) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ) : maintenanceStats && (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                                <div className="flex items-center gap-6">
                                    <div className="text-center">
                                        <div className="text-xl font-black text-gray-900 dark:text-white">{maintenanceStats.duplicates}</div>
                                        <div className="text-[10px] text-gray-400 uppercase font-bold">重复源</div>
                                    </div>
                                    <div className="w-px h-8 bg-gray-200 dark:bg-gray-700"></div>
                                    <div className="text-center">
                                        <div className="text-xl font-black text-red-600">{maintenanceStats.dead}</div>
                                        <div className="text-[10px] text-gray-400 uppercase font-bold">失效源</div>
                                    </div>
                                    <div className="w-px h-8 bg-gray-200 dark:bg-gray-700"></div>
                                    <div className="text-center">
                                        <div className="text-xl font-black text-green-600">{maintenanceStats.cleanedList.length}</div>
                                        <div className="text-[10px] text-gray-400 uppercase font-bold">最终可用</div>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => setMaintenanceStats(null)} className="px-5 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 transition-colors">取消</button>
                                    <button onClick={confirmCleanup} className="px-6 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-95">
                                        立即清理并保存
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto custom-scrollbar">
                    {allSources.map((s, idx) => {
                        const isCurrentlyWorking = sources.some(work => work.api === s.api);
                        return (
                            <div 
                                key={idx} 
                                className={`group flex flex-col p-4 rounded-2xl border transition-all ${currentSource.api === s.api ? 'bg-blue-50/30 dark:bg-blue-900/10 border-blue-500' : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 shadow-sm'} ${!isCurrentlyWorking ? 'opacity-60 border-dashed' : ''}`}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${s.isCustom ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/20' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/20'}`}>
                                            <Icon name={s.isCustom ? "person_outline" : "verified_user"} />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                                {s.name}
                                                {currentSource.api === s.api && <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-500 text-white font-bold tracking-tight">正在使用</span>}
                                                {!isCurrentlyWorking && <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-100 text-red-600 font-bold border border-red-200">已禁用</span>}
                                            </div>
                                            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">{s.isCustom ? '自定义线路' : '推荐线路'}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {isCurrentlyWorking && currentSource.api !== s.api && (
                                            <button onClick={() => onSourceChange(s)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all" title="切换到此源">
                                                <Icon name="swap_horiz" className="text-lg" />
                                            </button>
                                        )}
                                        {s.isCustom && (
                                            <button onClick={() => onRemoveCustomSource(s.api)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all" title="删除此源">
                                                <Icon name="delete_outline" className="text-lg" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div 
                                    onClick={() => copyToClipboard(s.api)}
                                    className={`mt-1 p-2.5 rounded-xl text-[10px] font-mono break-all cursor-pointer transition-all border flex items-center justify-between group/url ${copiedUrl === s.api ? 'bg-green-50 border-green-200 text-green-600' : 'bg-gray-50 dark:bg-slate-800/50 border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-200'}`}
                                >
                                    <span className="flex-1 truncate mr-4">{s.api}</span>
                                    <Icon name={copiedUrl === s.api ? "check" : "content_copy"} className={`text-xs ${copiedUrl === s.api ? 'text-green-500' : 'text-gray-300 group-hover/url:text-blue-500 transition-colors'}`} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="p-6 bg-blue-50/50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-900/20">
                <h4 className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-3 flex items-center gap-2">
                    <Icon name="info" className="text-lg" />管理指南
                </h4>
                <ul className="text-xs text-blue-600/70 dark:text-blue-400/70 space-y-2 list-disc pl-4">
                    <li><strong>全量健康检测</strong>：自动扫描列表中包含的所有线路（即使是之前被禁用的线路），识别重复项及失效死链，并将最新健康的列表应用到全局。</li>
                    <li><strong>图片加载</strong>：本站直接从 `vod_pic` 字段提取图片链接，配合 `no-referrer` 策略突破防盗链限制，不通过任何代理中转，加载更快捷。</li>
                    <li><strong>恢复默认</strong>：一键清除所有自定义源与禁用记录，应用将回退到官方初始推荐源站配置。</li>
                </ul>
            </div>
        </section>
      ) : (
        <>
          {mode !== 'FAVORITE' && (
            <nav className="mb-8 overflow-x-auto hide-scrollbar">
                {mode === 'SOURCE' ? (
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => { onStateUpdate({ activeCategoryId: '', movies: [] }); loadData(currentSource.api, '', 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === '' ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>全部</button>
                        {savedState.categories.map(cat => (
                            <button key={cat.id} onClick={() => { onStateUpdate({ activeCategoryId: cat.id, movies: [] }); loadData(currentSource.api, cat.id, 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === cat.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{cat.name}</button>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        {originalTags.map(tag => (
                            <button key={tag} onClick={() => onStateUpdate({ doubanTag: tag, doubanMovies: [] })} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.doubanTag === tag ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 ring-1 ring-pink-500' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{tag}</button>
                        ))}
                        {customDoubanTags.map(tag => (
                            <div key={tag} className="group relative"><button onClick={() => onStateUpdate({ doubanTag: tag, doubanMovies: [] })} className={`pl-4 pr-8 py-1.5 rounded-full text-sm font-medium transition-all border-dashed ${savedState.doubanTag === tag ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-white dark:bg-slate-800 text-gray-600 border border-gray-300'}`}>{tag}</button><button onClick={(e) => handleRemoveTag(e, tag)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"><Icon name="close" className="text-[14px]" /></button></div>
                        ))}
                        <button onClick={() => setShowAddTag(true)} className="w-8 h-8 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-pink-500 hover:border-pink-500 transition-all"><Icon name="add" className="text-xl" /></button>
                    </div>
                )}
            </nav>
          )}

          {history.length > 0 && mode !== 'FAVORITE' && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold flex items-center gap-2"><Icon name="history" className="text-blue-500" /> 播放历史</h2><button onClick={() => { if(confirmClear){ clearHistory(); setHistory([]); setConfirmClear(false); } else { setConfirmClear(true); setTimeout(()=>setConfirmClear(false), 3000); } }} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"><Icon name={confirmClear ? "warning" : "delete_outline"} className="text-sm" />{confirmClear ? "确认清除" : "清空"}</button></div>
              <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
                {history.slice(0, 10).map(m => (
                    <div key={m.id} className="min-w-[140px] max-w-[140px] relative group">
                        <MovieCard movie={m} viewType="HOME" onClick={() => handleMovieClick(m)} />
                        <button 
                            onClick={(e) => { e.stopPropagation(); removeFromHistory(m.id); setHistory(getHistory()); }} 
                            className="absolute top-2 right-2 w-7 h-7 bg-white dark:bg-slate-700 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-lg z-20 flex items-center justify-center border border-gray-100 dark:border-gray-600 hover:scale-110 active:scale-95"
                            title="删除此记录"
                        >
                            <Icon name="close" className="text-base font-bold"/>
                        </button>
                    </div>
                ))}
              </div>
            </section>
          )}

          <section className="min-h-[60vh]">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <span className={`w-1.5 h-6 rounded-full ${mode === 'DOUBAN' ? 'bg-pink-500' : mode === 'FAVORITE' ? 'bg-amber-500' : 'bg-blue-600'}`}></span>
                    {mode === 'DOUBAN' ? `豆瓣推荐: ${savedState.doubanTag}` : mode === 'FAVORITE' ? '我的收藏' : (savedState.activeCategoryId ? savedState.categories.find(c => c.id === savedState.activeCategoryId)?.name : '最新更新')}
                </h2>
                {mode === 'FAVORITE' && (
                   <button onClick={handleClearFavs} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${confirmClearFav ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>
                       <Icon name={confirmClearFav ? "priority_high" : "delete_sweep"} className="text-lg" />
                       {confirmClearFav ? "确认清空收藏" : "清空全部"}
                   </button>
                )}
            </div>

            {mode === 'FAVORITE' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                    {favorites.map((m) => (
                        <div key={m.id} className="relative group">
                            <MovieCard movie={m} viewType="HOME" onClick={() => handleMovieClick(m)} />
                            <button onClick={(e) => handleRemoveFavorite(e, m.id)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-20"><Icon name="bookmark_remove" className="text-lg" /></button>
                        </div>
                    ))}
                    {favorites.length === 0 && <div className="col-span-full py-20 flex flex-col items-center text-gray-400 italic"><Icon name="collections_bookmark" className="text-5xl mb-4" /><p>收藏夹空空如也，快去收藏喜欢的影视吧</p></div>}
                </div>
            ) : savedState.loading && (mode === 'DOUBAN' ? savedState.doubanMovies.length === 0 : savedState.movies.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4"><div className={`animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 ${mode === 'DOUBAN' ? 'border-pink-500' : 'border-blue-500'}`}></div><p className="text-sm text-gray-400">正在努力加载中...</p></div>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                        {(mode === 'DOUBAN' ? savedState.doubanMovies : savedState.movies).map((movie, idx) => (
                            <MovieCard key={`${movie.sourceApi}-${movie.id}-${idx}`} movie={movie} viewType="HOME" onClick={() => handleMovieClick(movie)} />
                        ))}
                    </div>
                    {(mode === 'DOUBAN' ? savedState.doubanMovies : savedState.movies).length > 0 && (
                        <div className="mt-16 flex justify-center pb-12"><button onClick={mode === 'DOUBAN' ? () => loadDoubanData(savedState.doubanType, savedState.doubanTag, savedState.doubanMovies.length) : () => loadData(currentSource.api, savedState.activeCategoryId, savedState.page + 1)} disabled={savedState.loading} className={`flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${savedState.loading ? 'bg-gray-100 dark:bg-slate-800 text-gray-400' : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200'}`}>加载更多内容</button></div>
                    )}
                </>
            )}
          </section>
        </>
      )}

      {/* 模态框逻辑 */}
      {showAddSource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4"><div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddSource(false)}></div><form onSubmit={handleAddSourceSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
                <h3 className="text-xl font-bold dark:text-white mb-6 flex items-center gap-2"><Icon name="add_circle" className="text-blue-500" />添加自定义采集源</h3>
                <div className="space-y-4">
                    <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">源站名称</label><input autoFocus required type="text" placeholder="例如：量子资源" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" value={newSourceName} onChange={e => setNewSourceName(e.target.value)}/></div>
                    <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">API 地址</label><input required type="url" placeholder="https://.../api.php/provide/vod/" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" value={newSourceApi} onChange={e => setNewSourceApi(e.target.value)}/></div>
                </div>
                <div className="flex gap-3 mt-8"><button type="button" onClick={() => setShowAddSource(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">取消</button><button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-lg shadow-blue-500/30">确认添加</button></div>
            </form></div>
      )}

      {showAddTag && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddTag(false)}></div>
          <form onSubmit={handleAddTagSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold dark:text-white mb-6 flex items-center gap-2"><Icon name="new_label" className="text-pink-500" />添加自定义标签</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">标签名称</label>
                <input autoFocus required type="text" placeholder="例如：宫崎骏" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 transition-all dark:text-white" value={newTagName} onChange={e => setNewTagName(e.target.value)}/>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={() => setShowAddTag(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">取消</button>
              <button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-pink-600 text-white shadow-lg shadow-pink-500/30">确认添加</button>
            </div>
          </form>
        </div>
      )}
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }
      `}</style>
    </main>
  );
};

export default Home;
