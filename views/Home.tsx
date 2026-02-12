
import React, { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Movie, HomeProps, Source } from '../types';
import MovieCard from '../components/MovieCard';
import DoubanModule from './DoubanList'; // Import the new smart module
import { Icon } from '../components/Icon';
import { fetchVideoList, fetchViaProxy } from '../utils/api';
import { 
  getHistory, 
  addToHistory, 
  clearHistory, 
  removeFromHistory,
  getFavorites,
  clearFavorites,
  removeFromFavorites,
  exportSourcesData,
  importSourcesData,
  exportFullBackup,
  importFullBackup,
  getDisabledSourceApis,
  getAccelerationConfig,
  setAccelerationConfig,
  getDoubanProxyUrl,
  setDoubanProxyUrl,
  DEFAULT_DOUBAN_PROXY
} from '../utils/storage';

const REMOTE_SOURCE_PRESETS = [
    { name: '在线源', url: 'https://a.wokaotianshi.eu.org/jgcj/zcying.json' },
    { name: '精简源(代理)', url: 'https://lunatvz.wofuck.dpdns.org/?format=1&source=jingjian&prefix=https://cfkua.wokaotianshi.eu.org/' },
    { name: '备用采集源', url: 'https://a.wokaotianshi.eu.org/jgcj/zyvying.json' }
];

interface MaintenanceStats {
    duplicates: number;
    dead: number;
    total: number;
    cleanedList: Source[];
    deadApis: string[];
    duplicateApis: string[];
}

interface ExtendedHomeProps extends HomeProps {
  allSources: Source[]; 
}

const Home: React.FC<ExtendedHomeProps> = ({ 
  setView, 
  onSelectMovie, 
  currentSource, 
  sources, 
  allSources, 
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
  const [mode, setMode] = useState<'SOURCE' | 'DOUBAN' | 'LIBRARY' | 'SETTINGS'>(savedState.isDoubanMode ? 'DOUBAN' : 'SOURCE');
  
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearFav, setConfirmClearFav] = useState(false);
  
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceApi, setNewSourceApi] = useState('');

  // 设置页面管理状态
  const [selectedApis, setSelectedApis] = useState<Set<string>>(new Set());
  const [isCheckingSources, setIsCheckingSources] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ current: 0, total: 0, name: '' });
  const [maintenanceStats, setMaintenanceStats] = useState<MaintenanceStats | null>(null);

  // 加速配置状态
  const [accConfig, setAccConfig] = useState(() => getAccelerationConfig());
  const [accUrlInput, setAccUrlInput] = useState(accConfig.url);

  // 豆瓣代理配置状态
  const [doubanProxyInput, setDoubanProxyInput] = useState(() => getDoubanProxyUrl());

  // 导入导出相关的状态
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [remoteSourceUrl, setRemoteSourceUrl] = useState(REMOTE_SOURCE_PRESETS[0].url);
  const [remoteBackupUrl, setRemoteBackupUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'SOURCE') {
      // 只有在数据为空或源API变更时才触发加载，避免切换回SOURCE时重新加载
      if (currentSource.api && (currentSource.api !== savedState.sourceApi || savedState.movies.length === 0)) {
        onStateUpdate({
            sourceApi: currentSource.api,
            movies: [],
            categories: [],
            activeCategoryId: '',
            page: 1,
            loading: true, // 使用源站专用 loading
            error: false
        });
        loadData(currentSource.api, '', 1);
      }
    } else if (mode === 'LIBRARY') {
      setFavorites(getFavorites());
    }
    setHistory(getHistory());
  }, [currentSource.api, mode]);

  useLayoutEffect(() => {
    if (mode === 'SOURCE') {
        if (!savedState.loading && savedState.scrollY > 0) {
            window.scrollTo(0, savedState.scrollY);
        }
    } else {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading, mode]);

  const loadData = async (apiUrl: string, typeId: string, pageNum: number) => {
    // 源站加载逻辑：只操作 loading/error
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

  const runSourceCheck = async () => {
    if (isCheckingSources) return;
    setIsCheckingSources(true);
    setMaintenanceStats(null);
    
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
    const duplicateApis: string[] = [];
    let duplicatesCount = 0;
    let deadCount = 0;

    for (let i = 0; i < allSources.length; i++) {
        const s = allSources[i];
        setCheckProgress({ current: i + 1, total: totalToMaintenace, name: `检测: ${s.name}` });

        if (seenApis.has(s.api)) {
            duplicatesCount++;
            duplicateApis.push(s.api);
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
        deadApis: deadApis,
        duplicateApis: duplicateApis
    });
    setIsCheckingSources(false);
  };

  const confirmCleanup = () => {
      if (!maintenanceStats) return;
      if (confirm(`检测完成！\n- 发现失效源: ${maintenanceStats.dead} 个\n- 发现重复项: ${maintenanceStats.duplicates} 个\n\n是否应用清理计划？`)) {
          const finalCustoms = maintenanceStats.cleanedList.filter(s => s.isCustom);
          onUpdateCustomSources(finalCustoms);
          onUpdateDisabledSources(maintenanceStats.deadApis);
          setMaintenanceStats(null);
          alert('源列表已优化');
      }
  };

  // --- 批量操作逻辑 ---
  const handleSelectAll = () => setSelectedApis(new Set(allSources.map(s => s.api)));
  const handleDeselectAll = () => setSelectedApis(new Set());

  const handleBatchEnable = (enable: boolean) => {
      if (selectedApis.size === 0) return;
      const currentDisabled = new Set(getDisabledSourceApis());
      selectedApis.forEach(api => {
          if (enable) currentDisabled.delete(api);
          else currentDisabled.add(api);
      });
      onUpdateDisabledSources(Array.from(currentDisabled));
      setSelectedApis(new Set());
  };

  const handleBatchDelete = () => {
      if (selectedApis.size === 0) return;
      if (confirm(`确定删除选中的 ${selectedApis.size} 个源？(仅对自定义源有效)`)) {
          const customs = allSources.filter(s => s.isCustom && !selectedApis.has(s.api));
          onUpdateCustomSources(customs);
          setSelectedApis(new Set());
      }
  };

  const toggleSourceEnabled = (api: string, currentEnabled: boolean) => {
      const currentDisabled = new Set(getDisabledSourceApis());
      if (currentEnabled) currentDisabled.add(api);
      else currentDisabled.delete(api);
      onUpdateDisabledSources(Array.from(currentDisabled));
  };

  const handleHandleToggleSelect = (api: string) => {
      const next = new Set(selectedApis);
      if (next.has(api)) next.delete(api);
      else next.add(api);
      setSelectedApis(next);
  };

  // --- 加速设置逻辑 ---
  const saveAcceleration = () => {
      setAccelerationConfig(accUrlInput.trim(), accConfig.enabled);
      setAccConfig({ ...accConfig, url: accUrlInput.trim() });
      alert('加速地址已保存');
  };

  const toggleAcceleration = () => {
      const newState = !accConfig.enabled;
      setAccelerationConfig(accConfig.url, newState);
      setAccConfig({ ...accConfig, enabled: newState });
      alert(newState ? '加速播放已启用' : '加速播放已禁用');
  };

  // --- 豆瓣代理设置逻辑 ---
  const saveDoubanProxy = () => {
      const val = doubanProxyInput.trim() || DEFAULT_DOUBAN_PROXY;
      setDoubanProxyUrl(val);
      setDoubanProxyInput(val);
      alert('豆瓣图片代理已更新');
  };

  const resetDoubanProxy = () => {
      setDoubanProxyUrl(DEFAULT_DOUBAN_PROXY);
      setDoubanProxyInput(DEFAULT_DOUBAN_PROXY);
      alert('已恢复默认代理');
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        // Fallback
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {}
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
  
  return (
    <main className="flex-grow max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-6 w-full animate-fadeIn">
      
      {/* 顶部主切换栏 */}
      <section className="mb-8">
          <div className="flex bg-white dark:bg-slate-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-x-auto hide-scrollbar items-center">
             <div className="flex bg-gray-100 dark:bg-slate-900/50 p-1 rounded-xl w-full sm:w-auto">
                <button 
                    onClick={() => { setMode('SOURCE'); onStateUpdate({ isDoubanMode: false }); }}
                    className={`flex-shrink-0 flex items-center justify-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'SOURCE' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    <Icon name="explore" className="text-base" /><span>浏览片库</span>
                </button>
                <button 
                    onClick={() => { setMode('DOUBAN'); onStateUpdate({ isDoubanMode: true }); }}
                    className={`flex-shrink-0 flex items-center justify-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'DOUBAN' ? 'bg-white dark:bg-slate-700 text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    <Icon name="whatshot" className="text-base" /><span>热榜推荐</span>
                </button>
                <button 
                    onClick={() => setMode('LIBRARY')}
                    className={`flex-shrink-0 flex items-center justify-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'LIBRARY' ? 'bg-white dark:bg-slate-700 text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    <Icon name="collections_bookmark" className="text-base" /><span>历史与收藏</span>
                </button>
             </div>
             
             {/* 独立的设置按钮 - 无下拉菜单 */}
             <div className="ml-auto pl-2">
                 <button 
                    onClick={() => setMode('SETTINGS')}
                    className={`p-3 rounded-xl transition-all ${mode === 'SETTINGS' ? 'bg-gray-200 dark:bg-slate-600 text-gray-900 dark:text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-600'}`}
                    title="设置"
                 >
                     <Icon name="settings" className="text-xl" />
                 </button>
             </div>
          </div>
      </section>

      {/* 核心内容区 */}
      {mode === 'DOUBAN' ? (
        <DoubanModule 
            state={savedState} 
            onUpdate={onStateUpdate} 
            onSelectMovie={(m) => onSearch(m.title, true)} 
        />
      ) : mode === 'LIBRARY' ? (
        <div className="animate-fadeIn min-h-[50vh] space-y-12">
            {/* History Section */}
            <section>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                        <Icon name="history" className="text-purple-600" />
                        <span>观看历史 ({history.length})</span>
                    </h2>
                    {history.length > 0 && (
                        <button 
                            onClick={() => {
                                if (confirmClear) {
                                    clearHistory();
                                    setHistory([]);
                                    setConfirmClear(false);
                                } else {
                                    setConfirmClear(true);
                                    setTimeout(() => setConfirmClear(false), 3000);
                                }
                            }} 
                            className={`text-xs px-4 py-2 rounded-lg font-bold transition-all flex items-center space-x-1 ${confirmClear ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:bg-red-50 hover:text-red-500'}`}
                        >
                            <Icon name="delete_sweep" />
                            <span>{confirmClear ? '确认清空?' : '清空全部'}</span>
                        </button>
                    )}
                </div>
                {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                        <Icon name="history_toggle_off" className="text-4xl mb-2 text-gray-300 dark:text-slate-600" />
                        <p className="text-sm">暂无观看记录</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-6">
                        {history.map((movie) => (
                            <div key={movie.id} className="relative group">
                                <div onClick={() => handleMovieClick(movie)}>
                                     <MovieCard 
                                        movie={movie} 
                                        viewType="HOME" 
                                        onClick={() => {}} 
                                        progress={(movie.currentTime || 0) / 60 * 100}
                                    />
                                </div>
                                 <button 
                                    onClick={(e) => { e.stopPropagation(); removeFromHistory(movie.id); setHistory(getHistory()); }}
                                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all z-20"
                                    title="删除记录"
                                >
                                    <Icon name="close" className="text-xs" />
                                </button>
                                {movie.currentEpisodeName && (
                                    <div className="absolute bottom-16 right-2 px-1.5 py-0.5 bg-black/70 text-white text-[10px] rounded backdrop-blur-md z-20 pointer-events-none truncate max-w-[80%]">
                                        {movie.currentEpisodeName}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Favorites Section */}
            <section>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                        <Icon name="bookmarks" className="text-yellow-600" />
                        <span>我的收藏 ({favorites.length})</span>
                    </h2>
                    {favorites.length > 0 && (
                        <button 
                            onClick={handleClearFavs}
                            className={`text-xs px-4 py-2 rounded-lg font-bold transition-all flex items-center space-x-1 ${confirmClearFav ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:bg-red-50 hover:text-red-500'}`}
                        >
                            <Icon name="delete_forever" />
                            <span>{confirmClearFav ? '确定清空全部?' : '清空收藏夹'}</span>
                        </button>
                    )}
                </div>
                {favorites.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                        <Icon name="bookmark_border" className="text-4xl mb-2 text-gray-300 dark:text-slate-600" />
                        <p className="text-sm">暂无收藏内容</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-6">
                        {favorites.map(movie => (
                            <div key={movie.id} className="relative group">
                                <MovieCard movie={movie} viewType="HOME" onClick={() => handleMovieClick(movie)} />
                                 <button 
                                    onClick={(e) => handleRemoveFavorite(e, movie.id)}
                                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all z-20"
                                    title="取消收藏"
                                >
                                    <Icon name="bookmark_remove" className="text-xs" />
                                </button>
                                {movie.sourceName && (
                                    <div className="absolute bottom-16 right-2 px-1.5 py-0.5 bg-blue-600/80 text-white text-[10px] rounded backdrop-blur-md z-20 pointer-events-none">
                                        {movie.sourceName}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
      ) : mode === 'SETTINGS' ? (
        <section className="animate-fadeIn max-w-4xl mx-auto space-y-8 pb-10">
            {/* 核心源切换 */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
                <h3 className="text-lg font-bold dark:text-white mb-6 flex items-center space-x-2 border-b border-gray-100 dark:border-gray-700 pb-4">
                    <Icon name="dns" className="text-blue-500" /><span>当前源切换</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sources.map((s, idx) => (
                        <button 
                            key={idx}
                            onClick={() => onSourceChange(s)}
                            className={`p-4 rounded-xl border text-sm font-bold flex items-center justify-between transition-all outline-none focus:ring-2 focus:ring-blue-500 ${currentSource.api === s.api ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-gray-50 dark:bg-slate-900 border-transparent text-gray-700 dark:text-gray-300 hover:border-blue-400'}`}
                        >
                            <span className="truncate">{s.name}</span>
                            {currentSource.api === s.api && <Icon name="check_circle" className="text-base" />}
                        </button>
                    ))}
                    <button 
                        onClick={() => setShowAddSource(true)}
                        className="p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 hover:text-blue-500 hover:border-blue-500 transition-all flex items-center justify-center space-x-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <Icon name="add_link" /><span>添加自定义源</span>
                    </button>
                </div>
            </div>

            {/* 设置面板 */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
                <h3 className="text-lg font-bold dark:text-white mb-6 flex items-center space-x-2 border-b border-gray-100 dark:border-gray-700 pb-4">
                    <Icon name="tune" className="text-blue-500" /><span>源站管理与检测</span>
                </h3>
                
                {/* 统计信息 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl text-center">
                        <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{allSources.length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1">总源数</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl text-center">
                        <div className="text-2xl font-black text-green-600 dark:text-green-400">{allSources.filter(s => !getDisabledSourceApis().includes(s.api)).length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1">可用源</div>
                    </div>
                    <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl text-center">
                        <div className="text-2xl font-black text-purple-600 dark:text-purple-400">{allSources.filter(s => s.isCustom).length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1">自定义源</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl text-center">
                        <div className="text-2xl font-black text-red-600 dark:text-red-400">{getDisabledSourceApis().length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1">已禁用</div>
                    </div>
                </div>

                {/* 操作栏 */}
                <div className="flex flex-wrap gap-3 mb-6">
                    <button 
                        onClick={runSourceCheck} 
                        disabled={isCheckingSources}
                        className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg font-bold text-sm transition-all shadow-sm ${isCheckingSources ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                    >
                        {isCheckingSources ? <Icon name="sync" className="animate-spin" /> : <Icon name="health_and_safety" />}
                        <span>{isCheckingSources ? '正在全量检测...' : '一键健康检测'}</span>
                    </button>
                    
                    {maintenanceStats && (
                        <button onClick={confirmCleanup} className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-bold text-sm bg-green-600 text-white hover:bg-green-700 transition-all shadow-sm animate-fadeIn">
                             <Icon name="cleaning_services" /><span>应用清理计划</span>
                        </button>
                    )}
                    
                    <div className="flex-1"></div>

                    {selectedApis.size > 0 && (
                        <>
                            <button onClick={() => handleBatchEnable(true)} className="px-4 py-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-xs font-bold transition-colors">启用选中</button>
                            <button onClick={() => handleBatchEnable(false)} className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-xs font-bold transition-colors">禁用选中</button>
                            <button onClick={handleBatchDelete} className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-xs font-bold transition-colors">删除选中</button>
                        </>
                    )}
                </div>

                {/* 进度条 */}
                {isCheckingSources && (
                     <div className="mb-6 bg-gray-100 dark:bg-slate-700 rounded-full h-4 overflow-hidden relative">
                         <div className="h-full bg-blue-500 transition-all duration-300 relative overflow-hidden" style={{ width: `${(checkProgress.current / checkProgress.total) * 100}%` }}>
                              <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                         </div>
                         <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-600 dark:text-gray-300">
                             {checkProgress.name} ({checkProgress.current}/{checkProgress.total})
                         </div>
                     </div>
                )}
                
                {/* 列表头 */}
                <div className="flex items-center justify-between py-2 px-4 bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-500 dark:text-gray-400">
                    <div className="flex items-center space-x-3 w-1/3">
                        <button onClick={selectedApis.size === allSources.length ? handleDeselectAll : handleSelectAll} className="hover:text-blue-500">
                            <Icon name={selectedApis.size === allSources.length && allSources.length > 0 ? "check_box" : "check_box_outline_blank"} />
                        </button>
                        <span>源名称</span>
                    </div>
                    <div className="w-1/3 text-center">状态</div>
                    <div className="w-1/3 text-right">操作</div>
                </div>

                {/* 源列表 */}
                <div className="max-h-[500px] overflow-y-auto custom-scrollbar border border-gray-100 dark:border-gray-700 rounded-b-xl divide-y divide-gray-100 dark:divide-gray-700">
                    {allSources.map((s, idx) => {
                        const isDisabled = getDisabledSourceApis().includes(s.api);
                        const isDead = maintenanceStats?.deadApis.includes(s.api);
                        const isDup = maintenanceStats?.duplicateApis.includes(s.api);
                        
                        return (
                            <div key={idx} className={`flex items-center justify-between p-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors ${isDisabled ? 'opacity-60 bg-gray-50/50' : ''}`}>
                                <div className="flex items-center space-x-3 w-1/3 overflow-hidden pr-2">
                                    <button onClick={() => handleHandleToggleSelect(s.api)} className={`flex-shrink-0 text-gray-400 ${selectedApis.has(s.api) ? 'text-blue-500' : ''}`}>
                                         <Icon name={selectedApis.has(s.api) ? "check_box" : "check_box_outline_blank"} />
                                    </button>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium truncate dark:text-gray-200" title={s.name}>
                                            {s.name}
                                            {s.isCustom && <span className="ml-2 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">自定义</span>}
                                        </span>
                                        <div className="flex items-center space-x-1 text-[10px] text-gray-400 mt-0.5">
                                            <span className="truncate max-w-[200px]" title={s.api}>{s.api}</span>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(s.api); }}
                                                className={`${copiedUrl === s.api ? 'text-green-500' : 'hover:text-blue-500'} transition-colors flex-shrink-0`}
                                                title="复制地址"
                                            >
                                                <Icon name={copiedUrl === s.api ? "check" : "content_copy"} className="text-[10px]" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="w-1/3 flex justify-center">
                                     {isDead ? (
                                         <span className="text-red-500 text-xs font-bold bg-red-50 px-2 py-1 rounded">失效</span>
                                     ) : isDup ? (
                                         <span className="text-orange-500 text-xs font-bold bg-orange-50 px-2 py-1 rounded">重复</span>
                                     ) : isDisabled ? (
                                         <span className="text-gray-400 text-xs font-bold bg-gray-100 px-2 py-1 rounded">已禁用</span>
                                     ) : (
                                         <span className="text-green-500 text-xs font-bold bg-green-50 px-2 py-1 rounded">正常</span>
                                     )}
                                </div>
                                <div className="w-1/3 flex justify-end items-center space-x-2">
                                     <button 
                                        onClick={() => toggleSourceEnabled(s.api, !isDisabled)}
                                        className={`p-1.5 rounded-lg transition-colors ${isDisabled ? 'text-gray-400 hover:text-green-500 bg-gray-100 hover:bg-green-50' : 'text-green-500 hover:text-gray-400 bg-green-50 hover:bg-gray-100'}`}
                                        title={isDisabled ? "启用" : "禁用"}
                                     >
                                         <Icon name={isDisabled ? "play_arrow" : "pause"} className="text-sm" />
                                     </button>
                                     {s.isCustom && (
                                         <button 
                                            onClick={() => { if(confirm(`删除源: ${s.name}?`)) onRemoveCustomSource(s.api); }}
                                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                            title="删除"
                                         >
                                             <Icon name="delete" className="text-sm" />
                                         </button>
                                     )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 高级功能区 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 播放加速配置 */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
                    <h3 className="font-bold dark:text-white mb-4 flex items-center space-x-2"><Icon name="speed" className="text-orange-500" /><span>播放加速服务</span></h3>
                    <div className="space-y-4">
                        <div className="flex items-center space-x-3 p-3 bg-orange-50 dark:bg-orange-900/10 rounded-xl">
                             <div className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${accConfig.enabled ? 'bg-green-500' : 'bg-gray-300'}`} onClick={toggleAcceleration}>
                                 <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${accConfig.enabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                             <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{accConfig.enabled ? '加速服务已开启' : '加速服务已关闭'}</span>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">加速节点地址</label>
                            <div className="flex space-x-2">
                                <input type="text" value={accUrlInput} onChange={e => setAccUrlInput(e.target.value)} className="flex-1 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-orange-500" />
                                <button onClick={saveAcceleration} className="px-3 py-2 bg-orange-500 text-white rounded-lg text-xs font-bold">保存</button>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-2">注：开启后将使用第三方节点转发m3u8流量，可解决部分资源跨域或加载慢的问题。</p>
                        </div>
                    </div>
                </div>

                {/* 豆瓣代理配置 */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
                    <h3 className="font-bold dark:text-white mb-4 flex items-center space-x-2"><Icon name="image" className="text-pink-500" /><span>豆瓣图片/API代理</span></h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">代理服务地址</label>
                            <div className="flex space-x-2">
                                <input type="text" value={doubanProxyInput} onChange={e => setDoubanProxyInput(e.target.value)} placeholder="例如: https://api.example.com/proxy/" className="flex-1 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-pink-500" />
                                <button onClick={saveDoubanProxy} className="px-3 py-2 bg-pink-500 text-white rounded-lg text-xs font-bold">保存</button>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <p className="text-[10px] text-gray-400">用于解决豆瓣图片403及API跨域问题。</p>
                                <button onClick={resetDoubanProxy} className="text-[10px] text-blue-500 hover:underline">恢复默认</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 导入导出 */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm md:col-span-2">
                    <h3 className="font-bold dark:text-white mb-4 flex items-center space-x-2"><Icon name="import_export" className="text-purple-500" /><span>数据备份与同步</span></h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                         {/* 源导入导出 */}
                         <div className="space-y-4">
                             <h4 className="text-sm font-bold text-gray-600 dark:text-gray-300">源列表维护</h4>
                             <div className="flex space-x-2">
                                 <button onClick={exportSourcesData} className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-slate-700 font-bold flex items-center justify-center space-x-1"><Icon name="file_download" /><span>导出源文件</span></button>
                                 <button onClick={() => sourceFileRef.current?.click()} className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 flex items-center justify-center space-x-1"><Icon name="file_upload" /><span>导入源文件</span></button>
                                 <input type="file" ref={sourceFileRef} onChange={handleSourceUpload} className="hidden" accept=".json,.txt" />
                             </div>
                             
                             <div className="bg-gray-50 dark:bg-slate-900/50 p-3 rounded-xl space-y-3">
                                 <label className="text-xs font-bold text-gray-500">远程源订阅</label>
                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                                     {REMOTE_SOURCE_PRESETS.map((p, i) => (
                                         <button 
                                             key={i} 
                                             onClick={() => setRemoteSourceUrl(p.url)}
                                             className={`px-3 py-2 rounded-lg text-xs font-bold text-left truncate border transition-all outline-none focus:ring-2 focus:ring-purple-500 ${remoteSourceUrl === p.url ? 'bg-purple-600 border-purple-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-purple-400'}`}
                                         >
                                             {p.name}
                                         </button>
                                     ))}
                                 </div>
                                 <div className="flex space-x-2">
                                     <input type="text" value={remoteSourceUrl} onChange={e => setRemoteSourceUrl(e.target.value)} className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-purple-500" placeholder="输入远程JSON地址" />
                                     <button onClick={handleRemoteSourceImport} disabled={isImporting} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold disabled:opacity-50 hover:bg-purple-700 transition-colors shadow-sm">
                                         {isImporting ? '同步中' : '同步'}
                                     </button>
                                 </div>
                             </div>
                         </div>

                         {/* 全量备份 */}
                         <div className="space-y-4">
                             <h4 className="text-sm font-bold text-gray-600 dark:text-gray-300">全站数据备份</h4>
                             <div className="flex space-x-2">
                                 <button onClick={exportFullBackup} className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-slate-700 font-bold flex items-center justify-center space-x-1"><Icon name="archive" /><span>一键备份</span></button>
                                 <button onClick={() => backupFileRef.current?.click()} className="flex-1 py-2 bg-green-50 text-green-600 rounded-lg text-xs font-bold hover:bg-green-100 flex items-center justify-center space-x-1"><Icon name="unarchive" /><span>一键还原</span></button>
                                 <input type="file" ref={backupFileRef} onChange={handleBackupUpload} className="hidden" accept=".json" />
                             </div>

                             <div className="bg-gray-50 dark:bg-slate-900/50 p-3 rounded-xl space-y-3">
                                 <label className="text-xs font-bold text-gray-500">远程备份恢复</label>
                                 <div className="flex space-x-2">
                                     <input type="text" value={remoteBackupUrl} onChange={e => setRemoteBackupUrl(e.target.value)} className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs" placeholder="输入备份文件URL" />
                                     <button onClick={handleRemoteBackupImport} disabled={isImporting} className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                                         {isImporting ? '下载中' : '恢复'}
                                     </button>
                                 </div>
                             </div>

                             <div className="pt-2">
                                 <button onClick={onResetSources} className="w-full py-2 border border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-xs font-bold transition-colors">重置所有设置 (危险)</button>
                             </div>
                         </div>
                    </div>
                </div>
            </div>
        </section>
      ) : (
        <section>
          {/* 分类筛选条 - 始终显示（如果有数据） */}
          {savedState.categories.length > 0 && (
              <div className="mb-6">
                  <div className="flex flex-wrap gap-2">
                      <button 
                          onClick={() => {
                              onStateUpdate({ activeCategoryId: '', movies: [], page: 1, loading: true });
                              loadData(currentSource.api, '', 1);
                          }} 
                          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${!savedState.activeCategoryId ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700'}`}
                      >
                          全部
                      </button>
                      {savedState.categories.map(cat => (
                          <button 
                              key={cat.id} 
                              onClick={() => {
                                  onStateUpdate({ activeCategoryId: cat.id, movies: [], page: 1, loading: true });
                                  loadData(currentSource.api, cat.id, 1);
                              }}
                              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${savedState.activeCategoryId === cat.id ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700'}`}
                          >
                              {cat.name}
                          </button>
                      ))}
                  </div>
              </div>
          )}

          {savedState.loading ? (
             <div className="flex flex-col justify-center items-center py-32 space-y-4 animate-fadeIn">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 dark:border-gray-700 border-t-blue-600 dark:border-t-blue-500"></div>
                <p className="text-sm font-bold text-gray-500 dark:text-gray-400 animate-pulse">加载中..</p>
             </div>
          ) : savedState.error ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Icon name="cloud_off" className="text-5xl text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-2">无法连接到源站</p>
                  <button onClick={() => loadData(currentSource.api, savedState.activeCategoryId, 1)} className="text-blue-500 hover:underline px-4 py-2">点击重试</button>
              </div>
          ) : savedState.movies.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Icon name="inbox" className="text-5xl text-gray-300 mb-4" />
                  <p className="text-gray-500">该分类下暂无内容</p>
              </div>
          ) : (
            <>
                {/* 恢复为 Grid 布局 */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-6">
                    {savedState.movies.map((movie) => (
                        <div key={movie.id}>
                             <MovieCard movie={movie} viewType="HOME" onClick={() => handleMovieClick(movie)} />
                        </div>
                    ))}
                </div>
                
                <div className="mt-8 flex justify-center pb-8">
                    <button 
                        onClick={() => loadData(currentSource.api, savedState.activeCategoryId, savedState.page + 1)}
                        className="px-8 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-full font-bold hover:shadow-lg hover:border-blue-400 transition-all text-sm flex items-center space-x-2"
                    >
                        <span>加载更多内容</span>
                        <Icon name="expand_more" />
                    </button>
                </div>
            </>
          )}
        </section>
      )}

      {showAddSource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddSource(false)}></div>
          <form onSubmit={handleAddSourceSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold dark:text-white mb-6 flex items-center gap-2"><Icon name="add_link" className="text-blue-500" />添加自定义源</h3>
            <div className="space-y-4">
              <input required type="text" placeholder="源名称" className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm" value={newSourceName} onChange={e => setNewSourceName(e.target.value)}/>
              <div>
                <input required type="text" placeholder="采集接口URL" className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm" value={newSourceApi} onChange={e => setNewSourceApi(e.target.value)}/>
                <p className="text-[10px] text-gray-400 mt-1.5 ml-1">示例: https://api.example.com/api.php/provide/vod/at/xml</p>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={() => setShowAddSource(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">取消</button>
              <button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-lg">确认添加</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
};

export default Home;
