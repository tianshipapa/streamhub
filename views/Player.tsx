
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
};

const getButtonHtml = (label: string, time: number, isActive: boolean, color: string) => {
    const bg = isActive ? `rgba(${color}, 0.8)` : 'rgba(0,0,0,0.5)';
    const border = isActive ? `rgba(${color}, 1)` : 'rgba(255,255,255,0.2)';
    const text = isActive ? `${label} ${Math.floor(time)}s` : label;
    return `<span style="font-size: 11px; padding: 2px 10px; cursor: pointer; background: ${bg}; border-radius: 4px; border: 1px solid ${border}; color: white; display: inline-block; min-width: 45px; text-align: center; transition: all 0.2s;">${text}</span>`;
};

// --- 生成选集列表的 HTML (优化版，移除顶部标题栏) ---
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

interface AltSource {
    source: Source;
    latency: number | null;
    movie: Movie | null;
    searching: boolean;
}

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
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [altSources, setAltSources] = useState<AltSource[]>([]);

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

  useEffect(() => {
    playListRef.current = playList;
  }, [playList]);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  // 更新选集图层内容
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

  useEffect(() => {
    if (playList.length > EPISODES_PER_SECTION && currentUrl) {
        const idx = playList.findIndex(ep => ep.url === currentUrl);
        if (idx !== -1) setCurrentSectionIndex(Math.floor(idx / EPISODES_PER_SECTION));
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
        detectAltSources(data.title);
      }
      setLoading(false);
    };
    if (movieId) loadDetails();
  }, [movieId, currentSource.api]);

  const detectAltSources = async (title: string) => {
    const others = sources.filter(s => s.api !== currentSource.api);
    setAltSources(others.map(s => ({ source: s, latency: null, movie: null, searching: true })));
    others.forEach(async (source) => {
        const startTime = Date.now();
        try {
            const results = await searchVideos(source.api, title);
            const latency = Date.now() - startTime;
            const matchedMovie = results.find(m => m.title === title) || results.find(m => m.title.includes(title)) || null;
            setAltSources(prev => prev.map(item => item.source.api === source.api ? { ...item, latency, movie: matchedMovie, searching: false } : item));
        } catch (e) {
            setAltSources(prev => prev.map(item => item.source.api === source.api ? { ...item, searching: false, movie: null, latency: 9999 } : item));
        }
    });
  };

  const sortedAltSources = useMemo(() => {
    return altSources.filter(alt => alt.movie || alt.searching).sort((a, b) => {
        if (a.searching && !b.searching) return 1;
        if (!a.searching && b.searching) return -1;
        return (a.latency || 0) - (b.latency || 0);
    });
  }, [altSources]);

  const handleAltSourceClick = (alt: AltSource) => {
    if (alt.movie) {
        const movieWithSource = { ...alt.movie, sourceApi: alt.source.api, sourceName: alt.source.name };
        addToHistory(movieWithSource);
        onSelectMovie(movieWithSource);
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

  const copyToClipboard = async (text: string) => {
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
      safeShowNotice('播放链接已复制');
    } catch (err) {}
  };

  const playNextEpisode = () => {
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
        }, 1500);
    }
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

  useEffect(() => {
    return () => {
        if (artRef.current) {
            artRef.current.destroy(false);
            artRef.current = null;
        }
    };
  }, [movieId]);

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

        if (currentUrl.includes('.m3u8')) {
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
                // 切换URL时，同时更新选集图层
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
                    poster: details?.image, // 修复图片加载：使用提取的 vod_pic
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
                        // 使用自定义的复杂动画作为内部缓冲图标
                        loading: `<div class="art-loading-custom">
                                    <div class="art-loading-glow"></div>
                                    <div class="art-loading-ring-outer"></div>
                                    <div class="art-loading-ring-inner"></div>
                                    <div class="art-loading-icon-bg"><i class="material-icons-round" style="font-size: 24px; color: #3b82f6;">smart_display</i></div>
                                  </div>`,
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

                                    // 处理分页标签点击
                                    if (tab) {
                                        const idx = Number((tab as HTMLElement).dataset.index);
                                        if (!isNaN(idx)) {
                                            setCurrentSectionIndex(idx);
                                        }
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
                                
                                if (!layer && art && art.template) {
                                    layer = art.template.$container.querySelector('.art-ep-layer-box');
                                }

                                if (layer) {
                                    if (layer.style.display === 'none' || !layer.style.display) {
                                        layer.style.display = 'flex';
                                    } else {
                                        layer.style.display = 'none';
                                    }
                                }
                            }
                        }
                    ],
                });
                artRef.current = art;

                art.on('ready', () => {
                    handleVideoReady(art);
                });

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

                art.on('video:ended', () => { playNextEpisode(); });
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
  }, [currentUrl, movieId, effectiveAccEnabled]);

  // 移除了初始的复杂加载动画，改为简单的文字提示
  if (loading) {
      return (
        <div className="flex flex-col justify-center items-center h-[60vh] sm:h-[70vh] animate-fadeIn">
            <div className="text-gray-400 text-sm animate-pulse flex items-center gap-2">
                <Icon name="sync" className="animate-spin text-base" />
                正在加载资源...
            </div>
        </div>
      );
  }
  
  if (!details) return <div className="text-center py-20 text-red-500 font-bold">内容加载失败</div>;

  return (
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn relative">
       {/* 注入播放器相关样式 */}
       <style>{`
        /* 滚动条样式优化 */
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.4); }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); }
        
        .art-control-volume { display: none !important; }

        /* Artplayer 内部缓冲图标美化：移植自原来的初始加载动画 */
        .art-loading-custom {
            position: relative;
            width: 80px;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .art-loading-glow {
            position: absolute;
            inset: 0;
            background-color: rgba(59, 130, 246, 0.2);
            border-radius: 9999px;
            filter: blur(12px);
            animation: art-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .art-loading-ring-outer {
            position: absolute;
            inset: 0;
            border: 2px solid transparent;
            border-top-color: rgba(59, 130, 246, 0.3);
            border-bottom-color: rgba(59, 130, 246, 0.3);
            border-radius: 9999px;
            animation: art-spin 3s linear infinite;
        }
        .art-loading-ring-inner {
            position: absolute;
            inset: 8px;
            border: 2px solid transparent;
            border-left-color: #2563eb;
            border-right-color: transparent;
            border-radius: 9999px;
            animation: art-spin 1s ease-in-out infinite;
        }
        .art-loading-icon-bg {
            position: relative;
            z-index: 10;
            width: 40px;
            height: 40px;
            background-color: rgba(30, 41, 59, 0.9);
            border-radius: 9999px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }
        
        @keyframes art-spin { to { transform: rotate(360deg); } }
        @keyframes art-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
        
        /* 选集列表样式系统 */
        .art-ep-layer-box {
            display: flex !important;
            flex-direction: column;
        }

        /* 标签栏 - 水平滚动 */
        .art-ep-tabs {
            display: flex;
            gap: 6px;
            overflow-x: auto;
            padding-bottom: 6px;
            margin-bottom: 8px;
            margin-top: 0; /* 移除顶部外边距，因为现在是第一个元素 */
            flex-shrink: 0;
            white-space: nowrap;
            scroll-behavior: smooth;
        }
        .art-ep-tab {
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            background: rgba(255,255,255,0.1);
            color: #aaa;
            border: 1px solid transparent;
            transition: all 0.2s;
        }
        .art-ep-tab:hover {
            background: rgba(255,255,255,0.2);
            color: white;
        }
        .art-ep-tab.active {
            background: #2196F3;
            color: white;
            border-color: #2196F3;
        }

        /* 列表区域 - 垂直滚动 + 响应式栅格 */
        .art-ep-list {
            display: grid;
            gap: 8px;
            overflow-y: auto;
            flex: 1;
            min-height: 0; /* 关键：允许Flex子项内部滚动 */
            padding-right: 4px;
            align-content: start;
            /* 默认桌面端尺寸 */
            grid-template-columns: repeat(auto-fill, minmax(75px, 1fr));
        }
        .art-ep-item {
            cursor: pointer;
            padding: 8px 5px;
            background: rgba(255,255,255,0.1);
            color: #ddd;
            border-radius: 6px;
            text-align: center;
            font-size: 12px;
            border: 1px solid transparent;
            transition: all 0.2s;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .art-ep-item:hover {
            background: rgba(255,255,255,0.25);
            color: white;
        }
        .art-ep-item.active {
            background: #2196F3;
            color: white;
            border-color: #2196F3;
        }

        /* 移动端/小屏适配 (宽度 < 500px) */
        @media (max-width: 500px) {
            .art-ep-layer-box {
                width: 60% !important;
                padding: 10px !important;
            }
            
            .art-ep-list {
                /* 手机端允许更小的格子 */
                grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
                gap: 4px;
            }
            .art-ep-item {
                font-size: 10px;
                padding: 3px 0;
                border-radius: 4px;
            }
            .art-ep-tabs {
                gap: 4px;
                padding-bottom: 4px;
            }
            .art-ep-tab {
                font-size: 10px;
                padding: 2px 6px;
            }
        }
      `}</style>

      {showShareModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowShareModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2"><Icon name="share" className="text-blue-500" />分享播放链接</h3>
            <div className="bg-gray-100 dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 break-all text-xs font-mono select-all">{currentUrl}</div>
            <button onClick={() => copyToClipboard(currentUrl)} className={`w-full mt-6 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold transition-all ${isCopied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
                <Icon name={isCopied ? "check_circle" : "content_copy"} />{isCopied ? '已复制' : '复制链接'}
            </button>
          </div>
        </div>
      )}

      <section className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black" style={{ paddingBottom: `${playerRatio}%` }}>
         <div ref={containerRef} className="absolute inset-0 w-full h-full"></div>
         {cleanStatus && <div className="absolute top-4 left-4 z-50 pointer-events-none"><div className="bg-black/70 text-green-400 px-3 py-1.5 rounded-lg text-[10px] backdrop-blur-md flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>{cleanStatus}</div></div>}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
             <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 items-center">
                        <span className="bg-blue-600 text-white px-2 py-0.5 rounded font-bold">{details.genre}</span>
                        <span>{details.year}</span><span>{details.badge}</span>
                        <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">当前源: {currentSource.name}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowShareModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent font-medium"><Icon name="share" className="text-lg" />分享</button>
                    <button onClick={handleFavoriteToggle} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-all border font-bold shadow-sm ${isFavorited ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 border-pink-200 dark:border-pink-800' : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-transparent hover:bg-gray-200 dark:hover:bg-slate-700'}`}>
                        <Icon name={isFavorited ? "bookmark" : "bookmark_border"} className="text-lg" />
                        {isFavorited ? '已收藏' : '收藏'}
                    </button>
                </div>
             </div>
             
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3 flex items-center gap-2"><Icon name="description" className="text-blue-500 text-lg" /> 剧情简介</h3>
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-6">{details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无详细介绍'}</p>
             </div>

             <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Icon name="swap_horiz" className="text-blue-500 text-lg" /> 全网切源检测</h3>
                <div className="max-h-72 overflow-y-auto pr-1 custom-scrollbar space-y-2.5">
                    {sortedAltSources.map((alt, idx) => (
                        <button key={idx} onClick={() => handleAltSourceClick(alt)} disabled={alt.searching} className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all ${alt.source.api === currentSource.api ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500' : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-gray-800 hover:border-blue-400'}`}>
                            <div className="flex items-center gap-3 text-left">
                                <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-500"><Icon name="dns" className="text-lg" /></div>
                                <div><div className="text-sm font-bold dark:text-white">{alt.source.name}</div><div className="text-[10px] text-gray-400">{alt.searching ? '检索中...' : (alt.movie ? `匹配成功` : '无结果')}</div></div>
                            </div>
                            {alt.latency && <div className="text-[10px] font-mono font-bold text-gray-400">{alt.latency}ms</div>}
                        </button>
                    ))}
                </div>
             </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 flex flex-col shadow-sm h-[500px] max-h-[80vh]">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    <Icon name="playlist_play" className="text-blue-500 text-lg" /> 选集列表
                </h3>
                <button onClick={toggleTempAcceleration} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black transition-all border ${effectiveAccEnabled ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 border-gray-200 dark:border-gray-600'}`}>
                    <Icon name="bolt" className="text-xs" />
                    {effectiveAccEnabled ? '加速已开启' : '点击加速'}
                </button>
            </div>
            <p className="text-[9px] text-gray-400 mb-4 flex-shrink-0">{playList.length} 个视频内容</p>
            {episodeSections.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-3 mb-3 hide-scrollbar flex-shrink-0">
                    {episodeSections.map((sec, idx) => (
                        <button key={idx} onClick={() => setCurrentSectionIndex(idx)} className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${currentSectionIndex === idx ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-500'}`}>{sec.label}</button>
                    ))}
                </div>
            )}
            <div className="overflow-y-auto pr-1 custom-scrollbar grid grid-cols-2 lg:grid-cols-3 gap-2 flex-1 min-h-0 content-start">
                {playList.slice(episodeSections.length > 0 ? episodeSections[currentSectionIndex].startIdx : 0, episodeSections.length > 0 ? episodeSections[currentSectionIndex].endIdx : playList.length).map((ep, index) => (
                    <button key={index} onClick={() => { if (currentUrl === ep.url) return; historyTimeRef.current = 0; hasAppliedHistorySeek.current = true; setCurrentUrl(ep.url); }} className={`text-[11px] py-2 rounded-lg transition-all truncate border font-medium ${currentUrl === ep.url ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 dark:bg-slate-700/50 text-gray-500 border-gray-200 dark:border-gray-600'}`}>{ep.name}</button>
                ))}
            </div>
        </div>
      </section>
    </main>
  );
};

export default Player;
