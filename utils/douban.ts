
import { Movie } from '../types';
import { fetchViaProxy } from './api';
import { getDoubanProxyUrl } from './storage';

// 内存缓存，避免重复请求
const imageCache = new Map<string, string | null>();

// 辅助函数：为豆瓣图片添加代理
const wrapDoubanImage = (url: string) => {
    if (!url) return '';
    const proxy = getDoubanProxyUrl();
    // 仅处理 doubanio.com 且未被代理过的链接
    if (url.includes('doubanio.com') && !url.startsWith(proxy)) {
        return `${proxy}${url}`;
    }
    return url;
};

/**
 * 获取单个电影的高清海报 (替换原失效的 QueryData，目前使用 WMDB)
 * @param id 豆瓣 ID
 */
export const fetchTmdbImage = async (id: string): Promise<string | null> => {
    if (!id) return null;
    
    // 检查缓存
    if (imageCache.has(id)) {
        return imageCache.get(id) || null;
    }

    // WMDB API: 目前最稳定的免费公开源，支持通过豆瓣 ID 获取高清资料
    const fetchFromWmdb = async () => {
        try {
            const controller = new AbortController();
            // 适当放宽超时时间，保证连接成功率
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            // 使用 WMDB 的通用 API
            const res = await fetch(`https://api.wmdb.tv/movie/api?id=${id}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (res.ok) {
                const data = await res.json();
                
                // WMDB 返回格式兼容处理 (可能是数组或对象)
                let entry = null;
                if (Array.isArray(data)) {
                    entry = data.length > 0 ? data[0] : null;
                } else if (data && data.data && Array.isArray(data.data)) {
                    entry = data.data.length > 0 ? data.data[0] : null;
                } else {
                    entry = data;
                }

                if (entry && entry.poster && !entry.poster.includes('noposter')) {
                    // 图片结果应用代理
                    return wrapDoubanImage(entry.poster);
                }
            }
        } catch (e) {
            // console.warn("WMDB fetch failed:", e);
        }
        return null;
    };

    try {
        // 随机微小延迟，错峰请求
        const delay = Math.floor(Math.random() * 300);
        await new Promise(resolve => setTimeout(resolve, delay));

        const poster = await fetchFromWmdb();

        if (poster) {
            imageCache.set(id, poster);
            return poster;
        }
    } catch (e) {
        // console.error("Image fetch error for", id, e);
    }
    
    // 失败或无图也记录缓存
    imageCache.set(id, null);
    return null;
};

/**
 * 独立的豆瓣推荐模块逻辑
 * 仅获取豆瓣列表数据，不阻塞等待高清图片
 */
export const fetchDoubanRecommend = async (type: 'movie' | 'tv', tag: string, pageStart: number = 0): Promise<Movie[]> => {
  const targetUrl = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=24&page_start=${pageStart}`;
  
  let data: any = null;

  // 策略 1: 优先尝试用户配置的 "豆瓣代理"
  // 这解决了 fetchViaProxy 轮询到不支持 Referer 的公共代理导致 403 的问题
  const userProxy = getDoubanProxyUrl();
  if (userProxy) {
      try {
          // 简单的拼接：用户代理通常是 https://api.yangzirui.com/proxy/ 这种格式
          const proxyUrl = `${userProxy}${targetUrl}`;
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时
          const res = await fetch(proxyUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (res.ok) {
              const text = await res.text();
              if (text && text.trim().startsWith('{')) {
                  data = JSON.parse(text);
              }
          }
      } catch (e) {
          // 用户代理失败，静默失败，进入策略 2
      }
  }

  // 策略 2: 如果策略1失败，回退到系统 fetchViaProxy (包含本地 /api/proxy 和其他公共代理)
  if (!data) {
    try {
        const text = await fetchViaProxy(targetUrl);
        if (text && text.trim().startsWith('{')) {
            data = JSON.parse(text);
        }
    } catch (e) {
        console.error("Douban fetch error:", e);
    }
  }

  // 如果所有策略都失败
  if (!data || !data.subjects) return [];
  
  return data.subjects.map((item: any) => {
        // 默认先尝试将 s_ratio_poster 替换为 l_ratio_poster 以获得稍好的体验
        let cover = item.cover || '';
        if (cover) {
            cover = cover.replace('s_ratio_poster', 'l_ratio_poster');
            // 列表缩略图应用代理
            cover = wrapDoubanImage(cover);
        }

        return {
            id: (item.id || '').toString(),
            title: item.title || '',
            year: '', 
            genre: tag,
            image: cover, 
            rating: parseFloat(item.rate) || 0,
            isDouban: true
        };
  });
};
