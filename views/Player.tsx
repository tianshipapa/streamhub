import React, { useEffect, useState, useRef } from 'react';
import { ViewState, Movie, PlayerProps } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl } from '../utils/api';
import { getMovieHistory, updateHistoryProgress } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
    Artplayer: any;
  }
}

// --- HLS Configuration ---
const HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    startBufferLength: 20,
    maxBufferLength: 120,
    maxMaxBufferLength: 600,
    maxBufferSize: 200 * 1024 * 1024,
    backBufferLength: 90,
    fragLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 6,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    maxLoadingDelay: 4, 
    minAutoBitrate: 0, 
    capLevelToPlayerSize: false, 
    autoStartLoad: true,
    maxBufferHole: 0.5,
};

// --- Helper: Dynamic Script Loader ---
const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
};

const waitForGlobal = async (key: 'Artplayer' | 'Hls', timeout = 3000): Promise<boolean> => {
    if (window[key]) return true;
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 100));
        if (window[key]) return true;
    }
    return false;
};

// --- Helper: Fetch and Clean M3U8 (Ad Removal) ---
const fetchAndCleanM3u8 = async (url: string, depth = 0): Promise<{ content: string; removedCount: number; log: string }> => {
    if (depth > 3) throw new Error("Redirect loop detected in M3U8 playlist");
    const toAbsolute = (p: string, b: string) => { try { return new URL(p, b).href; } catch(e) { return p; } };
    
    // 1. Fetch content
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const originalContent = await response.text();

    const lines = originalContent.split(/\r?\n/);

    // 2. Handle Master Playlist (Recursive fetch for highest bandwidth)
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

    // 3. Analyze Segments for Fingerprinting
    const segments: { idx: number; fp: string }[] = [];
    const fingerprintCounts: Record<string, number> = {};
    
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if(!trimmed || trimmed.startsWith('#')) return;
        const absUrl = toAbsolute(trimmed, url);
        let u; try { u = new URL(absUrl); } catch(e) { return; }
        // Fingerprint: Hostname + Path without filename
        const pathParts = u.pathname.split('/'); pathParts.pop(); 
        const fp = `${u.hostname}|${pathParts.join('/')}`;
        if(!fingerprintCounts[fp]) fingerprintCounts[fp] = 0;
        fingerprintCounts[fp]++;
        segments.push({ idx, fp });
    });
    
    // Find dominant fingerprint (The content)
    let dominantFp = '', maxC = 0;
    for(const [fp, c] of Object.entries(fingerprintCounts)) { if(c > maxC) { maxC = c; dominantFp = fp; } }
    
    // If homogeneity is too low, it might be already clean or mixed content we shouldn't touch
    if(segments.length === 0 || (maxC / segments.length) < 0.4) {
        return { content: originalContent, removedCount: 0, log: '未清洗 (特征不明显)' };
    }

    // 4. Mark lines to remove
    const linesToRemove = new Set<number>();
    segments.forEach(seg => {
        if(seg.fp !== dominantFp) {
            linesToRemove.add(seg.idx);
            // Trace back to remove associated metadata (EXTINF, etc)
            let j = seg.idx - 1;
            while(j >= 0) {
                const l = lines[j].trim();
                if(l.startsWith('#EXTINF') || l.startsWith('#EXT-X-BYTERANGE') || l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-DISCONTINUITY')) { linesToRemove.add(j); j--; } 
                else if (!l.startsWith('#EXT') && l.startsWith('#')) { j--; } 
                else if (l === '') { j--; } else { break; }
            }
        }
    });

    // 5. Reconstruct M3U8
    const newLines: string[] = [];
    lines.forEach((line, idx) => {
        if(linesToRemove.has(idx)) return;
        let content = line.trim();
        if(!content) return;
        if(content.startsWith('#')) {
            // Fix relative keys
            if(content.startsWith('#EXT-X-KEY') && content.includes('URI="')) {
                content = content.replace(/URI="([^"]+)"/, (m, p1) => `URI="${toAbsolute(p1, url)}"`);
            }
            newLines.push(content);
        } else {
            newLines.push(toAbsolute(content, url));
        }
    });
    
    const removedCount = segments.length - maxC;
    return { content: newLines.join('\n'), removedCount: depth > 0 ? (removedCount + 1) : removedCount, log: `已移除 ${removedCount} 个广告分片` };
};

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cleanStatus, setCleanStatus] = useState<string>('');
  const [playerRatio, setPlayerRatio] = useState<number>(56.25); // 16:9 Default
  
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const historyTimeRef = useRef<number>(0);
  const blobUrlRef = useRef<string | null>(null);
  const playbackRateRef = useRef<number>(1);
  const playListRef = useRef<{name: string, url: string}[]>([]);

  // Sync playlist ref for event callbacks
  useEffect(() => {
    playListRef.current = playList;
  }, [playList]);

  // Auto-hide clean status
  useEffect(() => {
    if (cleanStatus) {
        const timer = setTimeout(() => setCleanStatus(''), 5000);
        return () => clearTimeout(timer);
    }
  }, [cleanStatus]);

  // 1. Fetch Movie Details
  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      setPlayerRatio(56.25); 
      
      const data = await fetchVideoDetails(currentSource.api, movieId);
      if (data) {
        setDetails(data);
        const parsedEpisodes = parsePlayUrl(data.vod_play_url || '');
        setPlayList(parsedEpisodes);
        
        // --- RESTORE HISTORY LOGIC ---
        // 1. Get history item
        const historyItem = getMovieHistory(movieId);
        let startUrl = parsedEpisodes.length > 0 ? parsedEpisodes[0].url : '';
        
        if (historyItem) {
            // Restore timestamp
            historyTimeRef.current = historyItem.currentTime || 0;
            
            // Restore specific episode if exists in current playlist
            if (historyItem.currentEpisodeUrl) {
                const foundEp = parsedEpisodes.find(ep => ep.url === historyItem.currentEpisodeUrl);
                if (foundEp) {
                    startUrl = foundEp.url;
                }
            }
        } else {
             historyTimeRef.current = 0;
        }

        if (startUrl) {
            setCurrentUrl(startUrl);
        }
      }
      setLoading(false);
    };
    if (movieId) {
      loadDetails();
    }
  }, [movieId, currentSource]);

  // 2. Initialize Player when URL changes
  useEffect(() => {
    if (!currentUrl || !containerRef.current) return;
    let isMounted = true;

    const initPlayer = async () => {
        // Cleanup previous instance
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
        
        setCleanStatus('');

        // Ensure libraries are loaded
        try {
            let artReady = await waitForGlobal('Artplayer', 3000);
            let hlsReady = await waitForGlobal('Hls', 3000);

            if (!artReady) {
                 await loadScript("https://cdn.jsdelivr.net/npm/artplayer@5.1.1/dist/artplayer.js");
                 artReady = await waitForGlobal('Artplayer', 5000);
            }
            if (!hlsReady) {
                 await loadScript("https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js");
                 hlsReady = await waitForGlobal('Hls', 5000);
            }
            
            if (!artReady || !hlsReady) {
                 setCleanStatus('核心组件加载超时');
                 if (!isMounted) return;
                 return; 
            }
        } catch (e) {
            console.error("Script load error", e);
            setCleanStatus('组件加载错误');
            return;
        }

        if (!isMounted) return;

        let finalUrl = currentUrl;
        
        // Try M3U8 Cleaning
        if (currentUrl.includes('.m3u8')) {
            try {
                setCleanStatus('正在分析媒体流...');
                const result = await fetchAndCleanM3u8(currentUrl);
                if (!isMounted) return;

                if (result.removedCount > 0) {
                    const blob = new Blob([result.content], { type: 'application/vnd.apple.mpegurl' });
                    finalUrl = URL.createObjectURL(blob);
                    blobUrlRef.current = finalUrl;
                    setCleanStatus(`✅ 净化成功: ${result.log}`);
                } else {
                    setCleanStatus('');
                }
            } catch (e) {
                if (!isMounted) return;
                setCleanStatus('');
            }
        }

        if (!isMounted) return;

        const ArtplayerConstructor = window.Artplayer;

        // Init Artplayer
        const art = new ArtplayerConstructor({
            container: containerRef.current,
            url: finalUrl,
            poster: details?.image, 
            type: 'm3u8',
            volume: 0.7,
            isLive: false,
            muted: false,
            autoplay: true,
            pip: true,
            autoSize: false, 
            autoMini: false, // Changed to false to fix "cannot close" issue
            screenshot: true,
            setting: true,
            loop: false,
            flip: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            subtitleOffset: true,
            miniProgressBar: true,
            mutex: true,
            backdrop: true,
            playsInline: true,
            autoPlayback: true,
            airplay: true,
            theme: '#2196F3',
            lang: 'zh-cn',
            currentTime: historyTimeRef.current, // Crucial: Set initial time for native players
            moreVideoAttr: {
                crossOrigin: 'anonymous',
                playsInline: true,
                'webkit-playsinline': 'true',
            },
            customType: {
                m3u8: function (video: HTMLVideoElement, url: string, art: any) {
                    if (window.Hls.isSupported()) {
                        if (art.hls) art.hls.destroy();
                        const hls = new window.Hls(HLS_CONFIG);
                        hls.loadSource(url);
                        hls.attachMedia(video);
                        art.hls = hls;
                        
                        // Restore state when HLS manifest is parsed
                        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                            // Double check if time needs restoring
                            if (historyTimeRef.current > 0) {
                                art.currentTime = historyTimeRef.current;
                            }
                            if (playbackRateRef.current !== 1) {
                                art.playbackRate = playbackRateRef.current;
                            }
                            art.play();
                        });

                        art.on('destroy', () => hls.destroy());
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = url;
                        if (historyTimeRef.current > 0) {
                             video.currentTime = historyTimeRef.current;
                        }
                    } else {
                        art.notice.show = '不支持的播放格式: m3u8';
                    }
                }
            },
        });

        artRef.current = art;

        // --- Event Listeners ---

        art.on('ready', () => {
            if (playbackRateRef.current !== 1) {
                art.playbackRate = playbackRateRef.current;
            }
            // Additional seek check for MP4/Native
            if (historyTimeRef.current > 0 && Math.abs(art.currentTime - historyTimeRef.current) > 2) {
                art.currentTime = historyTimeRef.current;
            }
        });

        art.on('video:loadedmetadata', () => {
            const v = art.video;
            if (v && v.videoWidth && v.videoHeight) {
                let ratio = (v.videoHeight / v.videoWidth) * 100;
                if (ratio > 100) ratio = 100;
                if (ratio < 30) ratio = 30; 
                setPlayerRatio(ratio);
            }
        });

        art.on('video:ratechange', () => {
            playbackRateRef.current = art.playbackRate;
        });

        // Track progress & SAVE EPISODE INFO
        art.on('video:timeupdate', () => {
            if (art.currentTime > 5) {
                const currentEp = playListRef.current.find(e => e.url === currentUrl);
                updateHistoryProgress(movieId, art.currentTime, currentUrl, currentEp?.name);
            }
        });

        art.on('video:ended', () => {
            const list = playListRef.current;
            const currentIndex = list.findIndex(ep => ep.url === currentUrl);
            
            if (currentIndex !== -1 && currentIndex < list.length - 1) {
                const nextEp = list[currentIndex + 1];
                playbackRateRef.current = art.playbackRate;
                art.notice.show = `即将播放下一集: ${nextEp.name}`;
                
                setTimeout(() => {
                    historyTimeRef.current = 0; 
                    setCurrentUrl(nextEp.url); 
                }, 1000);
            } else {
                art.notice.show = '播放结束';
            }
        });
    };

    initPlayer();

    return () => {
        isMounted = false;
        if (artRef.current && artRef.current.destroy) {
            playbackRateRef.current = artRef.current.playbackRate;
            artRef.current.destroy(false);
            artRef.current = null;
        }
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
    };
  }, [currentUrl, movieId]);

  if (loading) {
      return (
        <div className="flex justify-center items-center h-[80vh]">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      );
  }

  if (!details) {
      return (
          <div className="text-center py-20 text-red-500">无法加载视频详情</div>
      );
  }

  return (
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn">
      {/* Player Section: Optimized for Mobile Ratio */}
      <section 
        className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black ring-1 ring-gray-800 transition-all duration-500 ease-in-out"
        style={{ paddingBottom: `${playerRatio}%` }}
      >
         {currentUrl ? (
             <>
                <div ref={containerRef} className="absolute inset-0 w-full h-full"></div>
                {cleanStatus && (
                    <div className="absolute top-4 left-4 z-50 pointer-events-none">
                        <div className="bg-black/70 text-green-400 border border-green-500/30 px-3 py-1.5 rounded-lg text-xs backdrop-blur-md shadow-lg animate-fadeIn flex items-center gap-2">
                             <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                             {cleanStatus}
                        </div>
                    </div>
                )}
             </>
         ) : (
             <div className="absolute inset-0 w-full h-full flex items-center justify-center text-white bg-gray-900">
                 <div className="text-center">
                    <Icon name="error_outline" className="text-5xl text-gray-600 mb-2" />
                    <p className="text-gray-400">暂无播放资源</p>
                 </div>
             </div>
         )}
      </section>

      {/* Info Section */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
             <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400 items-center">
                    <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold shadow-sm shadow-blue-500/30">{details.genre}</span>
                    <span className="flex items-center gap-1"><Icon name="calendar_today" className="text-xs" /> {details.year}</span>
                    <span className="flex items-center gap-1"><Icon name="high_quality" className="text-xs" /> {details.badge}</span>
                </div>
             </div>
             
             {/* Content */}
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Icon name="description" className="text-blue-500" /> 剧情简介
                </h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300 text-justify">
                    {details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无简介'}
                </p>
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <p className="flex gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white min-w-[3rem]">导演:</span> 
                        <span className="text-gray-600 dark:text-gray-400">{details.vod_director}</span>
                    </p>
                    <p className="flex gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white min-w-[3rem]">主演:</span> 
                        <span className="text-gray-600 dark:text-gray-400 line-clamp-2">{details.vod_actor}</span>
                    </p>
                </div>
             </div>
        </div>

        {/* Playlist Section */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 h-fit max-h-[600px] flex flex-col shadow-sm">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white flex items-center justify-between">
                <span className="flex items-center gap-2"><Icon name="playlist_play" className="text-blue-500" /> 选集</span>
                <span className="text-xs font-normal bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-full text-gray-500 dark:text-gray-400">{playList.length} 集</span>
            </h3>
            <div className="overflow-y-auto pr-1 hide-scrollbar">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {playList.map((ep, index) => (
                        <button 
                            key={index}
                            onClick={() => {
                                setCurrentUrl(ep.url);
                                historyTimeRef.current = 0; // Manual switch resets time
                            }}
                            className={`text-xs py-2.5 px-2 rounded-lg transition-all truncate border font-medium ${
                                currentUrl === ep.url 
                                ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20' 
                                : 'bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-slate-600'
                            }`}
                            title={ep.name}
                        >
                            {ep.name}
                        </button>
                    ))}
                </div>
                {playList.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                        <Icon name="broken_image" className="text-4xl mb-2 opacity-50" />
                        <p className="text-xs">暂无播放源</p>
                    </div>
                )}
            </div>
        </div>
      </section>
    </main>
  );
};

export default Player;