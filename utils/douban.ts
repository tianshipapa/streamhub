
import { Movie } from '../types';
import { fetchViaProxy } from './api';

// 内存缓存，避免重复请求 WMDB
const wmdbImageCache = new Map<string, string | null>();

/**
 * 获取单个电影的 WMDB 高清海报
 * @param id 豆瓣 ID
 */
export const fetchWMDBImage = async (id: string): Promise<string | null> => {
    if (!id) return null;
    
    // 检查缓存
    if (wmdbImageCache.has(id)) {
        return wmdbImageCache.get(id) || null;
    }

    try {
        // 随机延迟，错峰请求，避免瞬间并发过高触发限制
        const delay = Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, delay));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const wmdbRes = await fetch(`https://api.wmdb.tv/movie/api?id=${id}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (wmdbRes.ok) {
            const wmdbData = await wmdbRes.json();
            
            // 兼容返回数组或对象的情况
            let entry = null;
            if (Array.isArray(wmdbData)) {
                entry = wmdbData.length > 0 ? wmdbData[0] : null;
            } else if (wmdbData && wmdbData.data && Array.isArray(wmdbData.data)) {
                entry = wmdbData.data.length > 0 ? wmdbData.data[0] : null;
            } else {
                entry = wmdbData;
            }

            if (entry) {
                const poster = entry.poster;
                // 过滤无效图片
                if (poster && !poster.includes('noposter')) {
                    wmdbImageCache.set(id, poster);
                    return poster;
                }
            }
        }
    } catch (e) {
        // console.error("WMDB fetch error for", id, e);
    }
    
    // 失败或无图也记录缓存，防止重复无效请求 (Optional: 可设置过期时间，这里简化处理)
    wmdbImageCache.set(id, null);
    return null;
};

/**
 * 独立的豆瓣推荐模块逻辑
 * 仅获取豆瓣列表数据，不阻塞等待 WMDB 图片
 */
export const fetchDoubanRecommend = async (type: 'movie' | 'tv', tag: string, pageStart: number = 0): Promise<Movie[]> => {
  try {
    const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=24&page_start=${pageStart}`;
    
    // 豆瓣 API 必须走代理（解决跨域和 Referer 限制）
    const text = await fetchViaProxy(url);
    if (!text || !text.trim().startsWith('{')) return [];
    
    const data = JSON.parse(text);
    if (!data || !data.subjects) return [];
    
    // 立即返回列表，不处理 WMDB 逻辑，提高响应速度
    return data.subjects.map((item: any) => ({
        id: (item.id || '').toString(),
        title: item.title || '',
        year: '', 
        genre: tag,
        image: item.cover || '', // 默认使用豆瓣原图
        rating: parseFloat(item.rate) || 0,
        isDouban: true
    }));
  } catch (e) {
    console.error("Douban fetch error:", e);
    return [];
  }
};
