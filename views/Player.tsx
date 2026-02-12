
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ViewState, Movie, PlayerProps, Source } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl, searchVideos } from '../utils/api';
import { getMovieProgress, updateHistoryProgress, addToHistory, isFavorite, toggleFavorite, getAccelerationConfig, getSkipConfig, setSkipConfig, SkipConfig } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
    Artplayer: any;
  }
}

const HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    startBufferLength: 30, 
    maxBufferLength: 300, 
    maxMaxBufferLength: 1200,
    maxBufferSize: 512 * 1024 * 1024,
    backBufferLength: 120,
    fragLoadingTimeOut: 30000,
    fragLoadingMaxRetry: 10,
    levelLoadingTimeOut: 30000,
    manifestLoadingTimeOut: 30000,
    maxLoadingDelay: 5,
    maxBufferHole: 1.0,
    highBufferWatchdogPeriod: 3,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 10,
};

const EPISODES_PER_SECTION = 20;

const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
};

const waitForGlobal = async (key: 'Artplayer' | 'Hls', timeout = 10000): Promise<boolean> => {
    if (window[key]) return true;
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 100));
        if (window[key]) return true;
    }
    return false;
};

const fetchAndCleanM3u8 = async (url: string, depth = 0): Promise<{ content: string; removedCount: number; log: string }> => {
    if (depth > 3) throw new Error("Redirect loop detected");
    const toAbsolute = (p: string, b: string) => { try { return new URL(p, b).href; } catch(e) { return p; } };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const originalContent = await response.text();
        const lines = originalContent.split(/\r?\n/);

        if (originalContent.includes('#EXT-X-STREAM-INF')) {
            let bestUrl = null;
            let maxBandwidth = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('#EXT-X-STREAM-INF')) {
                    const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                    const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                    let j = i + 1;
                    while (j < lines.length) {
                        const nextLine = lines[j].trim();
                        if (nextLine && !nextLine.startsWith('#')) {
                            if (bandwidth > maxBandwidth) { maxBandwidth = bandwidth; bestUrl = nextLine; } 
                            else if (!bestUrl) { bestUrl = nextLine; }
                            break;
                        }
                        j++;
                    }
                }
            }
            if (bestUrl) return fetchAndCleanM3u8(toAbsolute(bestUrl, url), depth + 1);
        }

        const segments: { idx: number; fp: string }[] = [];
        const fingerprintCounts: Record<string, number> = {};
        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if(!trimmed || trimmed.startsWith('#')) return;
            const absUrl = toAbsolute(trimmed, url);
            let u; try { u = new URL(absUrl); } catch(e) { return; }
            const pathParts = u.pathname.split('/'); pathParts.pop(); 
            const fp = `${u.hostname}|${pathParts.join('/')}`;
            if(!fingerprintCounts[fp]) fingerprintCounts[fp] = 0;
            fingerprintCounts[fp]++;
            segments.push({ idx, fp });
        });
        
        let dominantFp = '', maxC = 0;
        for(const [fp, c] of Object.entries(fingerprintCounts)) { if(c > maxC) { maxC = c; dominantFp = fp; } }
        // 只有当主要分片占比小于 40% 时才认为可能是混合流，否则不轻易清洗，避免误杀
        if(segments.length === 0 || (maxC / segments.length) < 0.4) return { content: originalContent, removedCount: 0, log: '未清洗' };

        const linesToRemove = new Set<number>();
        segments.forEach(seg => {
            if(seg.fp !== dominantFp) {
                linesToRemove.add(seg.idx);
                let j = seg.idx - 1;
                while(j >= 0) {
                    const l = lines[j].trim();
                    if(l.startsWith('#EXTINF') || l.startsWith('#EXT-X-BYTERANGE') || l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-DISCONTINUITY')) { linesToRemove.add(j); j--; } 
                    else if (!l.startsWith('#EXT') && l.startsWith('#')) j--; 
                    else if (l === '') j--; else break;
                }
            }
        });

        const newLines: string[] = [];
        lines.forEach((line, idx) => {
            if(linesToRemove.has(idx)) return;
            let content = line.trim();
            if(!content) return;
            if(content.startsWith('#')) {
                if(content.startsWith('#EXT-X-KEY') && content.includes('URI="')) {
                    content = content.replace(/URI="([^"]+)"/, (m, p1) => `URI="${toAbsolute(p1, url)}"`);
                }
                newLines.push(content);
            } else newLines.push(toAbsolute(content, url));
        });
        return { content: newLines.join('\n'), removedCount: segments.length - maxC, log: `已移除 ${segments.length - maxC} 分片` };
    } catch(e) {
        clearTimeout(timeoutId);
        throw e;
    }
};

const getButtonHtml = (label: string, time: number, isActive: boolean, color: string) => {
    const bg = isActive ? `rgba(${color}, 0.8)` : 'rgba(0,0,0,0.5)';
    const border = isActive ? `rgba(${color}, 1)` : 'rgba(255,255,255,0.2)';
    const text = isActive ? `${label} ${Math.floor(time)}s` : label;
    return `<span style="font-size: 11px; padding: 2px 10px; cursor: pointer; background: ${bg}; border-radius: 4px; border: 1px solid ${border}; color: white; display: inline-block; min-width: 45px; text-align: center; transition: all 0.2s;">${text}</span>`;
};

const generateEpisodeLayerHtml = (list: {name: string, url: string}[], current: string, sectionIndex: number) => {
    if (!list || list.length === 0) return '<div style="color:#aaa;text-align:center;padding:20px;">暂无选集</div>';
    
    const totalSections = Math.ceil(list.length / EPISODES_PER_SECTION);
    const safeSectionIndex = Math.max(0, Math.min(sectionIndex, totalSections - 1));
    const startIdx = safeSectionIndex * EPISODES_PER_SECTION;
    const endIdx = Math.min((safeSectionIndex + 1) * EPISODES_PER_SECTION, list.length);
    const currentList = list.slice(startIdx, endIdx);

    let tabsHtml = '';
    if (totalSections > 1) {
         tabsHtml = `<div class="art-ep-tabs custom-scrollbar">
            ${Array.from({length: totalSections}).map((_, idx) => {
                const isActive = idx === safeSectionIndex;
                const start = idx * EPISODES_PER_SECTION + 1;
                const end = Math.min((idx + 1) * EPISODES_PER_SECTION, list.length);
                return `<div class="art-ep-tab ${isActive ? 'active' : ''}" data-index="${idx}">${start}-${end}</div>`;
            }).join('')}
        </div>`;
    }

    return `
        ${tabsHtml}
        <div class="art-ep-list custom-scrollbar">
            ${currentList.map(ep => `
                <div class="art-ep-item ${ep.url === current ? 'active' : ''}" data-url="${ep.url}" title="${ep.name}">
                    ${ep.name}
                </div>
            `).join('')}
        </div>
    `;
};

interface AltSourceStatus {
    source: Source;
    status: 'idle' | 'searching' | 'success' | 'empty' | 'error';
    latency?: number;
    movie?: Movie;
}

const ControlButton: React.FC<{ 
    icon: string; 
    text: string; 
    onClick: () => void; 
    active?: boolean; 
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
    buttonRef?: (el: HTMLButtonElement | null) => void;
}> = ({ icon, text, onClick, active, className = '', onKeyDown, buttonRef }) => (
    <button 
        ref={buttonRef}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={`flex flex-col items-center justify-center p-1.5 sm:px-3 sm:py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all border focus:ring-2 focus:ring-blue-400 focus:outline-none w-full h-full ${active ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-700 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-600'} ${className}`}
        tabIndex={0}
    >
        <Icon name={icon} className="text-xl sm:text-base mb-0.5" />
        <span className="whitespace-nowrap scale-[0.85] sm:scale-100 origin-center">{text}</span>
    </button>
);

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource, sources, onSelectMovie }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cleanStatus, setCleanStatus] = useState<string>('');
  const [playerRatio, setPlayerRatio] = useState<number>(56.25);
  const [isFavorited, setIsFavorited] = useState(false);
  const accConfig = useMemo(() => getAccelerationConfig(), []);
  const [isTempAccelerationEnabled, setIsTempAccelerationEnabled] = useState(false);
  
  // 选集分组状态
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  
  // 分享状态
  const [showShareModal, setShowShareModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // 切源状态
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [altSources, setAltSources] = useState<AltSourceStatus[]>([]);
  const [hasStartedSearch, setHasStartedSearch] = useState(false);

  // 描述展开状态
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  // 去广告开关，默认开启
  const [enableAdBlock, setEnableAdBlock] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const historyTimeRef = useRef<number>(0);
  const hasAppliedHistorySeek = useRef<boolean>(false);
  const blobUrlRef = useRef<string | null>(null);
  const isFullscreenRef = useRef<boolean>(false);
  const isWebFullscreenRef = useRef<boolean>(false);
  const playbackRateRef = useRef<number>(1);
  
  const playListRef = useRef<{name: string, url: string}[]>([]);
  const currentUrlRef = useRef<string>('');
  const skipConfigRef = useRef<SkipConfig>({ intro: 0, outroOffset: 0 });
  const episodeLayerRef = useRef<HTMLElement | null>(null);

  // 控制按钮引用
  const controlButtonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    playListRef.current = playList;
  }, [playList]);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  // 更新播放器内部选集层
  useEffect(() => {
    const updateLayer = () => {
         const html = generateEpisodeLayerHtml(playList, currentUrl, currentSectionIndex);
         if (episodeLayerRef.current) {
             episodeLayerRef.current.innerHTML = html;
         } else if (artRef.current && artRef.current.template) {
             const el = artRef.current.template.$container.querySelector('.art-ep-layer-box');
             if (el) el.innerHTML = html;
         }
    };
    updateLayer();
  }, [playList, currentUrl, currentSectionIndex]);

  // 计算选集分组
  const episodeSections = useMemo(() => {
    if (playList.length <= EPISODES_PER_SECTION) return [];
    const sections = [];
    for (let i = 0; i < playList.length; i += EPISODES_PER_SECTION) {
        const start = i + 1;
        const end = Math.min(i + EPISODES_PER_SECTION, playList.length);
        sections.push({ label: `${start}-${end}`, startIdx: i, endIdx: end });
    }
    return sections;
  }, [playList]);

  const effectiveAccEnabled = useMemo(() => accConfig.enabled || isTempAccelerationEnabled, [accConfig.enabled, isTempAccelerationEnabled]);

  // 自动跳转到当前集所在分组
  useEffect(() => {
    if (playList.length > EPISODES_PER_SECTION && currentUrl) {
        const idx = playList.findIndex(ep => ep.url === currentUrl);
        if (idx !== -1) {
            const section = Math.floor(idx / EPISODES_PER_SECTION);
            setCurrentSectionIndex(section);
        }
    }
  }, [currentUrl, playList]);

  const safeShowNotice = (msg: string) => {
    if (artRef.current?.notice) {
        try { artRef.current.notice.show = msg; } catch (e) {}
    }
  };

  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      setPlayerRatio(56.25);
      hasAppliedHistorySeek.current = false; 
      setIsFavorited(isFavorite(movieId));
      skipConfigRef.current = getSkipConfig(movieId);
      setAltSources([]); // 重置切源列表
      setHasStartedSearch(false);

      const historyItem = getMovieProgress(movieId);
      historyTimeRef.current = (historyItem?.currentTime && historyItem.currentTime > 5) ? historyItem.currentTime : 0;

      const data = await fetchVideoDetails(currentSource.api, movieId);
      if (data) {
        setDetails(data);
        const parsedEpisodes = parsePlayUrl(data.vod_play_url || '');
        setPlayList(parsedEpisodes);
        
        if (historyItem?.currentEpisodeUrl) {
            const found = parsedEpisodes.find(ep => ep.url === historyItem.currentEpisodeUrl);
            if (found) setCurrentUrl(found.url);
            else if (parsedEpisodes.length > 0) {
                setCurrentUrl(parsedEpisodes[0].url);
                historyTimeRef.current = 0; 
            }
        } else if (parsedEpisodes.length > 0) {
            setCurrentUrl(parsedEpisodes[0].url);
        }
      }
      setLoading(false);
    };
    if (movieId) loadDetails();
  }, [movieId, currentSource.api]);

  // 触发切源搜索
  const startAltSearch = () => {
      if (!details) return;
      setHasStartedSearch(true);
      
      const others = sources.filter(s => s.api !== currentSource.api);
      
      // 更新为搜索状态
      setAltSources(others.map(s => ({ source: s, status: 'searching' })));

      // 并发请求
      others.forEach(async (source) => {
        const start = Date.now();
        try {
            const res = await searchVideos(source.api, details.title);
            const latency = Date.now() - start;
            // 简单匹配逻辑
            const match = res.find(m => m.title === details.title) || res.find(m => m.title.includes(details.title));
            
            setAltSources(prev => prev.map(item => {
                if (item.source.api === source.api) {
                    return {
                        ...item,
                        status: match ? 'success' : 'empty',
                        latency,
                        movie: match ? { ...match, sourceApi: source.api, sourceName: source.name } : undefined
                    };
                }
                return item;
            }));
        } catch (e) {
             setAltSources(prev => prev.map(item => {
                if (item.source.api === source.api) {
                    return { ...item, status: 'error', latency: Date.now() - start };
                }
                return item;
            }));
        }
    });
  };

  // 初始化切源列表并自动开始搜索
  const handleCheckSources = () => {
      setShowSourceSelector(true);
      startAltSearch();
  };

  const sortedAltSources = useMemo(() => {
    return [...altSources].sort((a, b) => {
        // 成功的排前面
        if (a.status === 'success' && b.status !== 'success') return -1;
        if (a.status !== 'success' && b.status === 'success') return 1;
        // 然后是搜索中
        if (a.status === 'searching' && b.status !== 'searching') return -1;
        if (a.status !== 'searching' && b.status === 'searching') return 1;
        // 成功的按延迟排序
        if (a.status === 'success' && b.status === 'success') {
            return (a.latency || 0) - (b.latency || 0);
        }
        return 0;
    });
  }, [altSources]);

  const handleAltSourceClick = (alt: AltSourceStatus) => {
    if (alt.movie) {
        const movieWithSource = { ...alt.movie, sourceApi: alt.source.api, sourceName: alt.source.name };
        addToHistory(movieWithSource);
        onSelectMovie(movieWithSource);
        setShowSourceSelector(false);
    }
  };

  const handleFavoriteToggle = () => {
    if (details) {
        const res = toggleFavorite({ ...details, sourceApi: currentSource.api, sourceName: currentSource.name });
        setIsFavorited(res);
        safeShowNotice(res ? '✅ 已添加到收藏夹' : '⚠️ 已从收藏夹移除');
    }
  };

  const toggleTempAcceleration = () => {
      if (accConfig.enabled) { safeShowNotice('全局加速已开启'); return; }
      setIsTempAccelerationEnabled(!isTempAccelerationEnabled);
      safeShowNotice(!isTempAccelerationEnabled ? '已临时开启加速播放' : '已关闭临时加速');
  };

  const handleShare = () => {
      setShowShareModal(true);
      setIsCopied(false);
  };

  const getShareText = () => {
      if (!details) return currentUrl;
      return `正在观看《${details.title}》\n播放链接：${currentUrl}\n(分享自 StreamHub Vision)`;
  };

  const copyShareText = async () => {
    const text = getShareText();
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus(); textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      safeShowNotice('分享内容已复制');
    } catch (err) {}
  };

  const handleNextEpisode = () => {
    const list = playListRef.current;
    const current = currentUrlRef.current;
    const currentIndex = list.findIndex(ep => ep.url === current);
    if (currentIndex !== -1 && currentIndex < list.length - 1) {
        const nextEp = list[currentIndex + 1];
        safeShowNotice(`即将播放: ${nextEp.name}`);
        setTimeout(() => { 
            historyTimeRef.current = 0; 
            hasAppliedHistorySeek.current = true; 
            setCurrentUrl(nextEp.url); 
        }, 500);
    } else {
        safeShowNotice('已是最后一集');
    }
  };

  const handlePrevEpisode = () => {
    const list = playListRef.current;
    const current = currentUrlRef.current;
    const currentIndex = list.findIndex(ep => ep.url === current);
    if (currentIndex > 0) {
        const prevEp = list[currentIndex - 1];
        safeShowNotice(`即将播放: ${prevEp.name}`);
        setTimeout(() => { 
            historyTimeRef.current = 0; 
            hasAppliedHistorySeek.current = true; 
            setCurrentUrl(prevEp.url); 
        }, 500);
    } else {
        safeShowNotice('已是第一集');
    }
  };

  const handleForward15 = () => {
    if (artRef.current) {
        artRef.current.currentTime = Math.min(artRef.current.currentTime + 15, artRef.current.duration);
        safeShowNotice('快进 15s');
    }
  };

  const handleBackward15 = () => {
    if (artRef.current) {
        artRef.current.currentTime = Math.max(artRef.current.currentTime - 15, 0);
        safeShowNotice('快退 15s');
    }
  };

  const toggleAdBlock = () => {
      const newState = !enableAdBlock;
      setEnableAdBlock(newState);
      safeShowNotice(newState ? '已开启去广告 (尝试重载)' : '已关闭去广告 (加载原画)');
  };

  const handleSetIntro = () => {
      if(!artRef.current) return;
      const time = artRef.current.currentTime;
      const currentIntro = skipConfigRef.current.intro;
      const newIntro = currentIntro > 0 ? 0 : time;
      const config = { ...skipConfigRef.current, intro: newIntro };
      skipConfigRef.current = config;
      setSkipConfig(movieId, config);
      artRef.current.controls.update({
          name: 'skip-intro',
          html: getButtonHtml('片头', newIntro, newIntro > 0, '33, 150, 243')
      });
      safeShowNotice(newIntro > 0 ? `片头跳过点: ${Math.floor(newIntro)}s` : `已取消片头跳过`);
  };

  const handleSetOutro = () => {
      if(!artRef.current) return;
      const time = artRef.current.currentTime;
      const duration = artRef.current.duration || 0;
      if (duration <= 0) return;
      const offset = duration - time;
      const currentOutro = skipConfigRef.current.outroOffset;
      const newOutro = currentOutro > 0 ? 0 : offset;
      const config = { ...skipConfigRef.current, outroOffset: newOutro };
      skipConfigRef.current = config;
      setSkipConfig(movieId, config);
      artRef.current.controls.update({
          name: 'skip-outro',
          html: getButtonHtml('片尾', newOutro, newOutro > 0, '255, 152, 0')
      });
      safeShowNotice(newOutro > 0 ? `片尾跳过点已设为距结尾: ${Math.floor(newOutro)}s` : `已取消片尾跳过`);
  };

  const handleCycleSpeed = () => {
      if(!artRef.current) return;
      const rates = [1.0, 1.25, 1.5, 2.0];
      const current = artRef.current.playbackRate;
      const nextIdx = rates.findIndex(r => r > current);
      const next = nextIdx === -1 ? rates[0] : rates[nextIdx];
      artRef.current.playbackRate = next;
      safeShowNotice(`倍速: ${next}x`);
  };

  const handleToggleFullscreen = () => {
      if(!artRef.current) return;
      artRef.current.fullscreen = !artRef.current.fullscreen;
  };

  const handleVideoReady = (art: any) => {
    if (historyTimeRef.current > 5 && !hasAppliedHistorySeek.current) {
        art.currentTime = historyTimeRef.current;
        hasAppliedHistorySeek.current = true;
        if (art.notice) art.notice.show = `已自动恢复播放进度`;
    } else {
        const config = skipConfigRef.current;
        if (config.intro > 1) {
            art.currentTime = config.intro;
            if (art.notice) art.notice.show = `已自动跳过片头`;
        }
    }
    if (isWebFullscreenRef.current) art.fullscreenWeb = true;
    if (isFullscreenRef.current) art.fullscreen = true;
  };

  // 键盘导航逻辑
  const handleControlKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    // 阻止事件冒泡，防止触发全局键盘监听（如快进/快退）
    e.stopPropagation();

    const totalButtons = 10;
    let nextIndex = index;

    switch(e.key) {
        case 'ArrowRight':
            e.preventDefault();
            nextIndex = (index + 1) % totalButtons;
            break;
        case 'ArrowLeft':
            e.preventDefault();
            nextIndex = (index - 1 + totalButtons) % totalButtons;
            break;
        case 'ArrowDown':
            e.preventDefault();
            if (index < 5) nextIndex = index + 5;
            break;
        case 'ArrowUp':
            e.preventDefault();
            if (index >= 5) nextIndex = index - 5;
            break;
    }

    if (nextIndex !== index && controlButtonsRef.current[nextIndex]) {
        controlButtonsRef.current[nextIndex]?.focus();
    }
  };

  // 遥控器/键盘全局监听
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (!artRef.current) return;
        // 避免在输入框或按钮聚焦时触发
        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'button') return;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            artRef.current.currentTime = Math.min(artRef.current.currentTime + 10, artRef.current.duration);
            safeShowNotice(`快进: ${Math.floor(artRef.current.currentTime)}s`);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            artRef.current.currentTime = Math.max(artRef.current.currentTime - 10, 0);
            safeShowNotice(`快退: ${Math.floor(artRef.current.currentTime)}s`);
        } else if (e.key === ' ') {
            e.preventDefault();
            artRef.current.toggle();
        }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    return () => {
        if (artRef.current) {
            artRef.current.destroy(false);
            artRef.current = null;
        }
    };
  }, [movieId]);

  // 播放器核心加载逻辑
  useEffect(() => {
    if (!currentUrl || !containerRef.current) return;
    let cleanTimeoutId: any = null;
    let isMounted = true;

    const playVideo = async () => {
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        setCleanStatus('');
        
        let finalUrl = currentUrl;
        if (effectiveAccEnabled && accConfig.url) {
            const prefix = accConfig.url.endsWith('/') ? accConfig.url.slice(0, -1) : accConfig.url;
            finalUrl = `${prefix}/${currentUrl}`;
        }

        // 仅在 enableAdBlock 为真时执行去广告逻辑
        if (enableAdBlock && currentUrl.includes('.m3u8')) {
            try {
                setCleanStatus('流处理中...');
                const result = await fetchAndCleanM3u8(finalUrl);
                if (isMounted && result.removedCount > 0) {
                    const blob = new Blob([result.content], { type: 'application/vnd.apple.mpegurl' });
                    finalUrl = URL.createObjectURL(blob);
                    blobUrlRef.current = finalUrl;
                    setCleanStatus(`✅ 已去除广告`);
                    cleanTimeoutId = setTimeout(() => { if (isMounted) setCleanStatus(''); }, 5000);
                } else if (isMounted) setCleanStatus('');
            } catch (e) { if (isMounted) setCleanStatus(''); }
        }

        if (!isMounted) return;

        try {
            let artReady = await waitForGlobal('Artplayer', 5000);
            let hlsReady = await waitForGlobal('Hls', 5000);
            if (!artReady) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/artplayer/5.3.0/artplayer.js"); artReady = await waitForGlobal('Artplayer', 10000); }
            if (!hlsReady) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js"); hlsReady = await waitForGlobal('Hls', 10000); }

            if (!isMounted) return;
            if (!window.Artplayer) throw new Error("Artplayer load failed");

            if (artRef.current) {
                await artRef.current.switchUrl(finalUrl);
                if (episodeLayerRef.current) {
                    episodeLayerRef.current.innerHTML = generateEpisodeLayerHtml(playListRef.current, currentUrl, currentSectionIndex);
                }
                handleVideoReady(artRef.current);
            } else {
                const ArtplayerConstructor = window.Artplayer;
                const art = new ArtplayerConstructor({
                    container: containerRef.current,
                    url: finalUrl,
                    type: 'm3u8',
                    volume: 0.7,
                    poster: details?.image, 
                    autoplay: true,
                    theme: '#2196F3',
                    lang: 'zh-cn',
                    lock: true,
                    fastForward: true,
                    screenshot: false,
                    playbackRate: true,
                    aspectRatio: true,
                    fullscreen: true,
                    fullscreenWeb: true,
                    miniProgressBar: true,
                    mutex: true,
                    backdrop: true,
                    playsInline: true,
                    autoSize: false,
                    autoMini: false,
                    setting: true,
                    pip: false,
                    airplay: false,
                    icons: {
                        loading: `<div class="art-buffering-animation"><div class="ring-glow"></div><div class="ring-outer"></div><div class="ring-inner"></div><div class="icon-center"><i class="material-icons-round" style="font-size: 26px; color: #3b82f6;">smart_display</i></div></div>`,
                    },
                    customType: {
                        m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
                            if (window.Hls && window.Hls.isSupported()) {
                                const hls = new window.Hls(HLS_CONFIG);
                                hls.loadSource(url);
                                hls.attachMedia(video);
                                artInstance.hls = hls;
                                hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                                    if (playbackRateRef.current !== 1) artInstance.playbackRate = playbackRateRef.current;
                                    artInstance.play().catch(() => {});
                                });
                            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                video.src = url;
                            }
                        }
                    },
                    layers: [
                        {
                            name: 'episode-layer',
                            html: generateEpisodeLayerHtml(playListRef.current, currentUrl, currentSectionIndex),
                            class: 'art-ep-layer-box',
                            style: {
                                display: 'none',
                                position: 'absolute',
                                top: '0',
                                right: '0',
                                bottom: '60px', 
                                width: '300px',
                                maxWidth: '80%',
                                backgroundColor: 'rgba(20, 20, 20, 0.95)',
                                backdropFilter: 'blur(10px)',
                                zIndex: 200, 
                                flexDirection: 'column',
                                padding: '20px',
                                overflow: 'hidden',
                                transform: 'translateX(0)',
                                borderLeft: '1px solid rgba(255,255,255,0.1)'
                            },
                            mounted: function($el: HTMLElement) {
                                episodeLayerRef.current = $el;
                                $el.addEventListener('click', (e) => {
                                    const target = e.target as HTMLElement;
                                    const item = target.closest('.art-ep-item');
                                    const tab = target.closest('.art-ep-tab');
                                    if (target === $el) {
                                         $el.style.display = 'none';
                                         return;
                                    }
                                    if (tab) {
                                        const idx = Number((tab as HTMLElement).dataset.index);
                                        if (!isNaN(idx)) setCurrentSectionIndex(idx);
                                        return;
                                    }
                                    if (item) {
                                         const url = (item as HTMLElement).dataset.url;
                                         if (url && url !== currentUrlRef.current) {
                                              historyTimeRef.current = 0;
                                              hasAppliedHistorySeek.current = true;
                                              setCurrentUrl(url);
                                              $el.style.display = 'none';
                                         }
                                    }
                                });
                            }
                        }
                    ],
                    controls: [
                        {
                            name: 'skip-intro',
                            position: 'right',
                            html: getButtonHtml('片头', skipConfigRef.current.intro, skipConfigRef.current.intro > 0, '33, 150, 243'),
                            tooltip: '设置/取消 片头跳过点',
                            click: function () {
                                const art = artRef.current;
                                if (!art) return;
                                const time = art.currentTime;
                                const currentIntro = skipConfigRef.current.intro;
                                const newIntro = currentIntro > 0 ? 0 : time;
                                const config = { ...skipConfigRef.current, intro: newIntro };
                                skipConfigRef.current = config;
                                setSkipConfig(movieId, config);
                                art.controls.update({
                                    name: 'skip-intro',
                                    html: getButtonHtml('片头', newIntro, newIntro > 0, '33, 150, 243')
                                });
                                if (art.notice) art.notice.show = newIntro > 0 ? `片头跳过点已设为: ${Math.floor(newIntro)}s` : `已取消片头跳过`;
                            },
                        },
                        {
                            name: 'skip-outro',
                            position: 'right',
                            html: getButtonHtml('片尾', skipConfigRef.current.outroOffset, skipConfigRef.current.outroOffset > 0, '255, 152, 0'),
                            tooltip: '设置/取消 片尾跳过点',
                            click: function () {
                                const art = artRef.current;
                                if (!art) return;
                                const time = art.currentTime;
                                const duration = art.duration || 0;
                                if (duration <= 0) return;
                                const offset = duration - time;
                                const currentOutro = skipConfigRef.current.outroOffset;
                                const newOutro = currentOutro > 0 ? 0 : offset;
                                const config = { ...skipConfigRef.current, outroOffset: newOutro };
                                skipConfigRef.current = config;
                                setSkipConfig(movieId, config);
                                art.controls.update({
                                    name: 'skip-outro',
                                    html: getButtonHtml('片尾', newOutro, newOutro > 0, '255, 152, 0')
                                });
                                if (art.notice) art.notice.show = newOutro > 0 ? `片尾跳过点已设为距结尾: ${Math.floor(newOutro)}s` : `已取消片尾跳过`;
                            },
                        },
                        {
                            name: 'show-episodes',
                            position: 'right',
                            html: `<div style="display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.15);color:white;transition:all 0.2s;">选集</div>`,
                            tooltip: '选集列表',
                            click: function () {
                                const art = artRef.current;
                                let layer = episodeLayerRef.current;
                                if (!layer && art && art.template) layer = art.template.$container.querySelector('.art-ep-layer-box');
                                if (layer) layer.style.display = (layer.style.display === 'none' || !layer.style.display) ? 'flex' : 'none';
                            }
                        }
                    ],
                });
                artRef.current = art;
                art.on('ready', () => handleVideoReady(art));
                art.on('fullscreen', (state: boolean) => { isFullscreenRef.current = state; });
                art.on('fullscreenWeb', (state: boolean) => { isWebFullscreenRef.current = state; });
                art.on('video:ratechange', () => { playbackRateRef.current = art.playbackRate; });
                art.on('video:timeupdate', () => {
                    const time = art.currentTime;
                    const duration = art.duration;
                    if (time > 5) {
                        const url = currentUrlRef.current;
                        const ep = playListRef.current.find(item => item.url === url);
                        updateHistoryProgress(movieId, time, url, ep?.name);
                    }
                    const config = skipConfigRef.current;
                    if (config.outroOffset > 0 && duration > 0 && (duration - time) <= config.outroOffset) {
                        if (Math.abs(duration - time) > 1.5) {
                             art.currentTime = duration;
                             if (art.notice) art.notice.show = `自动跳过片尾`;
                        }
                    }
                });
                art.on('video:ended', () => handleNextEpisode());
            }
        } catch (e) { 
            console.error(e);
            setCleanStatus('播放器加载失败'); 
        }
    };
    playVideo();
    return () => {
        isMounted = false;
        if (cleanTimeoutId) clearTimeout(cleanTimeoutId);
    };
  }, [currentUrl, movieId, effectiveAccEnabled, enableAdBlock]);

  if (loading) {
      return (
        <div className="flex flex-col justify-center items-center h-[60vh] sm:h-[70vh] animate-fadeIn space-y-2">
            <div className="text-gray-400 text-sm animate-pulse flex items-center space-x-2">
                <Icon name="sync" className="animate-spin text-base" />
                正在加载资源...
            </div>
        </div>
      );
  }
  
  if (!details) return <div className="text-center py-20 text-red-500 font-bold">内容加载失败</div>;

  return (
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn relative">
       <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); }
        
        .art-control-volume { display: none !important; }

        .art-loading-custom, .art-buffering-animation {
            position: relative;
            width: 80px;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ring-glow {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(59, 130, 246, 0.2);
            border-radius: 50%;
            filter: blur(12px);
            animation: ring-pulse 2s ease-in-out infinite;
        }
        .ring-outer {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            border: 2px solid transparent;
            border-top-color: rgba(59, 130, 246, 0.3);
            border-bottom-color: rgba(59, 130, 246, 0.3);
            border-radius: 50%;
            animation: art-spin 3s linear infinite;
        }
        .ring-inner {
            position: absolute;
            top: 8px; left: 8px; right: 8px; bottom: 8px;
            border: 2px solid transparent;
            border-left-color: #3b82f6;
            border-radius: 50%;
            animation: art-spin 1s ease-in-out infinite;
        }
        .icon-center {
            position: relative;
            z-index: 10;
            width: 44px;
            height: 44px;
            background-color: rgba(15, 23, 42, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        @keyframes art-spin { to { transform: rotate(360deg); } }
        @keyframes ring-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.1); } }
        
        .art-ep-layer-box { display: flex !important; flex-direction: column; }
        .art-ep-tabs { display: flex; overflow-x: auto; padding-bottom: 6px; margin-bottom: 8px; flex-shrink: 0; white-space: nowrap; scroll-behavior: smooth; }
        .art-ep-tab { cursor: pointer; padding: 2px 8px; border-radius: 4px; font-size: 12px; background: rgba(255,255,255,0.1); color: #aaa; transition: all 0.2s; margin-right: 6px; }
        .art-ep-tab.active { background: #2196F3; color: white; }
        .art-ep-list { display: flex; flex-wrap: wrap; overflow-y: auto; flex: 1; min-height: 0; padding-right: 4px; align-content: start; }
        
        .art-ep-item { 
            cursor: pointer; 
            padding: 8px 2px; 
            background: #f1f5f9; 
            color: #334155; 
            border-radius: 6px; 
            text-align: center; 
            font-size: 12px; 
            transition: all 0.2s; 
            width: calc(20% - 5px); 
            margin-bottom: 5px; 
            margin-right: 5px; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            white-space: nowrap;
            border: 1px solid #e2e8f0;
        }
        
        .dark .art-ep-item, .art-ep-layer-box .art-ep-item {
            background: rgba(255,255,255,0.1); 
            color: #e2e8f0; 
            border: 1px solid transparent;
        }

        .art-ep-item.active, .dark .art-ep-item.active { 
            background: #2563eb; 
            color: white; 
            border-color: #2563eb;
        }

        @media (max-width: 640px) { 
            .art-ep-item { 
                width: calc(25% - 5px); 
            } 
        }
        
        @media (max-width: 500px) { 
            .art-ep-layer-box { width: 60% !important; padding: 10px !important; } 
        }
      `}</style>

      {/* 分享弹窗 */}
      {showShareModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowShareModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center space-x-2"><Icon name="share" className="text-blue-500" /><span>分享内容</span></h3>
            <textarea 
                readOnly 
                className="w-full h-32 bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                value={getShareText()}
            />
            <button onClick={copyShareText} className={`w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-bold transition-all ${isCopied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                <Icon name={isCopied ? "check_circle" : "content_copy"} /><span>{isCopied ? '已复制到剪贴板' : '一键复制'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 视频容器 */}
      <section className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black" style={{ paddingBottom: `${playerRatio}%` }}>
         <div ref={containerRef} className="absolute top-0 right-0 bottom-0 left-0 w-full h-full"></div>
         {cleanStatus && <div className="absolute top-4 left-4 z-50 pointer-events-none"><div className="bg-black/70 text-green-400 px-3 py-1.5 rounded-lg text-[10px] backdrop-blur-md flex items-center space-x-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span><span>{cleanStatus}</span></div></div>}
      </section>

      {/* 播放控制栏：改为所有屏幕统一 5列网格布局，确保2行显示 */}
      <section className="bg-gray-50 dark:bg-slate-800 p-2 sm:p-3 rounded-2xl border border-gray-100 dark:border-gray-700">
          <div className="grid grid-cols-5 gap-2">
            <ControlButton icon="skip_previous" text="上一集" onClick={handlePrevEpisode} buttonRef={(el) => controlButtonsRef.current[0] = el} onKeyDown={(e) => handleControlKeyDown(e, 0)} />
            <ControlButton icon="skip_next" text="下一集" onClick={handleNextEpisode} buttonRef={(el) => controlButtonsRef.current[1] = el} onKeyDown={(e) => handleControlKeyDown(e, 1)} />
            <ControlButton icon="fast_rewind" text="快退" onClick={handleBackward15} buttonRef={(el) => controlButtonsRef.current[2] = el} onKeyDown={(e) => handleControlKeyDown(e, 2)} />
            <ControlButton icon="fast_forward" text="快进" onClick={handleForward15} buttonRef={(el) => controlButtonsRef.current[3] = el} onKeyDown={(e) => handleControlKeyDown(e, 3)} />
            <ControlButton icon="cleaning_services" text="去广告" onClick={toggleAdBlock} active={enableAdBlock} buttonRef={(el) => controlButtonsRef.current[4] = el} onKeyDown={(e) => handleControlKeyDown(e, 4)} />
            
            <ControlButton icon="start" text="片头" onClick={handleSetIntro} buttonRef={(el) => controlButtonsRef.current[5] = el} onKeyDown={(e) => handleControlKeyDown(e, 5)} />
            <ControlButton icon="last_page" text="片尾" onClick={handleSetOutro} buttonRef={(el) => controlButtonsRef.current[6] = el} onKeyDown={(e) => handleControlKeyDown(e, 6)} />
            <ControlButton icon="wifi_tethering" text="切源" onClick={handleCheckSources} buttonRef={(el) => controlButtonsRef.current[7] = el} onKeyDown={(e) => handleControlKeyDown(e, 7)} />
            <ControlButton icon="speed" text="倍速" onClick={handleCycleSpeed} buttonRef={(el) => controlButtonsRef.current[8] = el} onKeyDown={(e) => handleControlKeyDown(e, 8)} />
            <ControlButton icon="fullscreen" text="全屏" onClick={handleToggleFullscreen} buttonRef={(el) => controlButtonsRef.current[9] = el} onKeyDown={(e) => handleControlKeyDown(e, 9)} />
          </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
             {/* 标题区域 */}
             <div className="flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0">
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                    <div className="flex flex-wrap text-xs text-gray-500 dark:text-gray-400 items-center space-x-3">
                        <span className="bg-blue-600 text-white px-2 py-0.5 rounded font-bold">{details.genre}</span>
                        <span>{details.year}</span><span>{details.badge}</span>
                        <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">当前源: {currentSource.name}</span>
                    </div>
                </div>
                <div className="flex space-x-2">
                    <button onClick={handleShare} className="flex items-center space-x-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent font-medium"><Icon name="share" className="text-lg" /><span>分享</span></button>
                    <button onClick={handleFavoriteToggle} className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm transition-all border font-bold shadow-sm ${isFavorited ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 border-pink-200 dark:border-pink-800' : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-transparent hover:bg-gray-200 dark:hover:bg-slate-700'}`}>
                        <Icon name={isFavorited ? "bookmark" : "bookmark_border"} className="text-lg" />
                        <span>{isFavorited ? '已收藏' : '收藏'}</span>
                    </button>
                </div>
             </div>
             
             {/* 简介卡片 */}
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3 flex items-center space-x-2"><Icon name="description" className="text-blue-500 text-lg" /> <span>剧情简介</span></h3>
                <div 
                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                    className={`text-xs leading-relaxed text-gray-500 dark:text-gray-400 cursor-pointer transition-all ${isDescExpanded ? '' : 'line-clamp-3'}`}
                >
                    {details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无详细介绍'}
                </div>
                <div className="text-center mt-2">
                    <button onClick={() => setIsDescExpanded(!isDescExpanded)} className="text-blue-500 text-[10px] hover:underline flex items-center justify-center w-full">
                        <Icon name={isDescExpanded ? "expand_less" : "expand_more"} />
                    </button>
                </div>
             </div>
        </div>

        {/* 右侧选集列表 */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 flex flex-col shadow-sm h-[500px] max-h-[80vh]">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center space-x-2">
                    <Icon name="playlist_play" className="text-blue-500 text-lg" /> <span>选集列表</span>
                </h3>
                <button onClick={toggleTempAcceleration} className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-black transition-all border ${effectiveAccEnabled ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 border-gray-200 dark:border-gray-600'}`}>
                    <Icon name="bolt" className="text-xs" />
                    <span>{effectiveAccEnabled ? '加速已开启' : '点击加速'}</span>
                </button>
            </div>
            <p className="text-[9px] text-gray-400 mb-4 flex-shrink-0">{playList.length} 个视频内容</p>
            {episodeSections.length > 0 && (
                <div className="flex space-x-2 overflow-x-auto pb-3 mb-3 hide-scrollbar flex-shrink-0">
                    {episodeSections.map((sec, idx) => (
                        <button key={idx} onClick={() => setCurrentSectionIndex(idx)} className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${currentSectionIndex === idx ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-500'}`}>{sec.label}</button>
                    ))}
                </div>
            )}
            <div className="art-ep-list custom-scrollbar">
                {playList.slice(episodeSections.length > 0 ? episodeSections[currentSectionIndex].startIdx : 0, episodeSections.length > 0 ? episodeSections[currentSectionIndex].endIdx : playList.length).map((ep, index) => (
                    <button key={index} onClick={() => { if (currentUrl === ep.url) return; historyTimeRef.current = 0; hasAppliedHistorySeek.current = true; setCurrentUrl(ep.url); }} className={`art-ep-item ${currentUrl === ep.url ? 'active' : ''}`}>{ep.name}</button>
                ))}
            </div>
        </div>
      </section>

      {/* 切源模态框 (懒加载) */}
      {showSourceSelector && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowSourceSelector(false)}>
              <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <h3 className="font-bold text-lg dark:text-white">全网切源 - {details?.title}</h3>
                      <button onClick={() => setShowSourceSelector(false)}><Icon name="close" /></button>
                  </div>
                  <div className="p-4 overflow-y-auto custom-scrollbar flex-1">
                      {!hasStartedSearch ? (
                          <div className="flex flex-col items-center justify-center py-10 space-y-4">
                              <Icon name="search" className="text-4xl text-gray-300" />
                              <p className="text-sm text-gray-500 text-center px-8">正在启动全网搜索...</p>
                          </div>
                      ) : (
                          <div className="space-y-2">
                             {sortedAltSources.map((alt, idx) => (
                                <button key={idx} onClick={() => handleAltSourceClick(alt)} disabled={alt.status === 'searching'} className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${alt.source.api === currentSource.api ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500' : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-gray-800 hover:border-blue-400'}`}>
                                    <div className="flex items-center space-x-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs ${alt.status === 'success' ? 'bg-green-500' : alt.status === 'searching' ? 'bg-blue-400' : 'bg-gray-300 dark:bg-slate-700'}`}>
                                            {alt.status === 'searching' ? <Icon name="sync" className="animate-spin text-lg" /> : alt.status === 'success' ? 'OK' : '无'}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold dark:text-white">{alt.source.name}</div>
                                            <div className="text-[10px] text-gray-400">
                                                {alt.status === 'searching' && '检索中...'}
                                                {alt.status === 'success' && alt.movie && (alt.movie.badge || '匹配成功')}
                                                {alt.status === 'empty' && '未找到资源'}
                                                {alt.status === 'error' && '连接超时'}
                                            </div>
                                        </div>
                                    </div>
                                    {alt.latency && (
                                        <div className={`text-[10px] font-mono font-bold ${alt.latency < 500 ? 'text-green-500' : alt.latency < 2000 ? 'text-yellow-500' : 'text-red-500'}`}>
                                            {alt.latency}ms
                                        </div>
                                    )}
                                </button>
                             ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </main>
  );
};

export default Player;
