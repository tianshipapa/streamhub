
import { Movie, Category, Source } from '../types';

// Detect Electron environment
const isElectron = typeof navigator !== 'undefined' && 
  (navigator.userAgent.toLowerCase().includes(' electron/') || (window as any).process?.type === 'renderer');

// Detect HBuilderX (5+ App) environment
const isHBuilder = typeof navigator !== 'undefined' && (navigator.userAgent.indexOf('Html5Plus') > -1 || (window as any).plus);

// 代理配置仅用于 API 请求
interface ProxyConfig {
  url: string;
  type: 'append' | 'query';
}

const PROXIES: ProxyConfig[] = [
  // Electron 或 HBuilderX (App) 环境下优先使用直连
  ...(isElectron || isHBuilder ? [{ url: '', type: 'append' }] as ProxyConfig[] : []),
  // Web 环境下使用本地 Proxy 或公共 Proxy
  { url: '/api/proxy?url=', type: 'query' },
  // 移除 corsproxy.io，因为可能导致部分地区连接困难或被墙
  { url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'query' },
  { url: 'https://api.allorigins.win/raw?url=', type: 'query' },
];

export const fetchViaProxy = async (targetUrl: string, externalSignal?: AbortSignal): Promise<string> => {
  let lastError = null;
  // 增加超时时间到 15s，防止网络波动导致的 signal aborted
  const TIMEOUT_MS = 15000;

  for (const proxy of PROXIES) {
    if (externalSignal?.aborted) throw new Error("Aborted");
    
    try {
      const url = proxy.type === 'query' ? `${proxy.url}${encodeURIComponent(targetUrl)}` : `${proxy.url}${targetUrl}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS); 
      
      let signal = controller.signal;
      if (externalSignal) {
        if ((AbortSignal as any).any) {
          signal = (AbortSignal as any).any([controller.signal, externalSignal]);
        } else {
          // Fallback if AbortSignal.any is not supported
          signal = controller.signal;
        }
      }

      try {
        const response = await fetch(url, { signal });
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const text = await response.text();
          if (text && text.trim().length > 0) {
            // 简单的 HTML 检测，防止代理返回错误页面
            if (text.trim().toLowerCase().startsWith('<!doctype html') || text.trim().toLowerCase().startsWith('<html')) {
               if (!targetUrl.includes('ac=list') && !targetUrl.includes('ac=detail') && !targetUrl.includes('douban.com')) {
                   throw new Error("Proxy returned HTML instead of data");
               }
            }
            return text;
          }
        }
        throw new Error(`HTTP status ${response.status}`);
      } catch (e: any) {
        clearTimeout(timeoutId);
        
        // 外部手动取消
        if (externalSignal?.aborted) throw e;

        // 内部超时处理 (controller.abort() 默认抛出 AbortError)
        if (e.name === 'AbortError') {
             // 将 AbortError 转换为普通的 Timeout Error，避免上层误判为用户取消
             lastError = new Error(`Request timed out after ${TIMEOUT_MS}ms`);
             continue; // 继续尝试下一个代理
        } else {
             lastError = e;
        }
      }
    } catch (error: any) {
      if (externalSignal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to fetch`);
};

const getBaseHost = (apiUrl: string): string => {
    try {
        const url = new URL(apiUrl);
        return `${url.protocol}//${url.host}`;
    } catch (e) { return ""; }
};

// 修复图片加载：直接提取 vod_pic，仅处理相对路径补全，绝不走代理
const formatImageUrl = (url: string, apiHost: string, providedDomain?: string): string => {
    if (!url) return "";
    let cleaned = url.trim();
    
    // 如果是完整链接，直接返回，不走代理
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
    if (cleaned.startsWith('//')) return 'https:' + cleaned;
    
    // 处理相对路径
    const domain = (providedDomain || apiHost).replace(/\/$/, '');
    if (cleaned.startsWith('/')) return domain + cleaned;
    if (!cleaned.includes('://')) return domain + '/' + cleaned;
    
    return cleaned;
};

const getTagValue = (element: Element, tagNames: string[]): string => {
    for (const tag of tagNames) {
        const el = element.getElementsByTagName(tag)[0];
        if (el && el.textContent) return el.textContent.trim();
    }
    return "";
};

const sanitizeXml = (xml: string): string => {
    if (!xml) return "";
    return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
              .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
};

const mapJsonToMovie = (v: any, apiHost: string, picDomain?: string): Movie => ({
    id: (v.vod_id || v.id || '').toString(),
    vod_id: (v.vod_id || v.id || '').toString(),
    title: v.vod_name || v.name || '',
    // 直接提取图片链接
    image: formatImageUrl(v.vod_pic || v.pic || v.vod_img || v.vod_pic_thumb || '', apiHost, picDomain),
    genre: v.type_name || v.type || '',
    year: v.vod_year || v.year || '',
    badge: v.vod_remarks || v.note || '',
    badgeColor: 'black',
    vod_content: v.vod_content || v.des || '',
    vod_actor: v.vod_actor || v.actor || '',
    vod_director: v.vod_director || v.director || '',
    vod_play_url: v.vod_play_url || ''
});

const parseMacCMSXml = (xmlText: string, apiHost: string) => {
    try {
        const cleanXml = sanitizeXml(xmlText);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");
        const videos: Movie[] = [];
        
        const listTag = xmlDoc.getElementsByTagName("list")[0];
        const picDomain = listTag?.getAttribute("pic_domain") || listTag?.getAttribute("vod_pic_domain") || undefined;
        
        const videoTags = xmlDoc.getElementsByTagName("video"); 
        for (let i = 0; i < videoTags.length; i++) {
            const v = videoTags[i];
            const movieData = {
                id: getTagValue(v, ["id", "vod_id"]),
                name: getTagValue(v, ["name", "vod_name"]),
                pic: getTagValue(v, ["vod_pic", "pic", "vod_img", "img"]),
                type: getTagValue(v, ["type", "type_name"]),
                year: getTagValue(v, ["year", "vod_year"]),
                note: getTagValue(v, ["note", "vod_remarks"]),
                des: getTagValue(v, ["des", "vod_content"]),
                actor: getTagValue(v, ["actor", "vod_actor"]),
                director: getTagValue(v, ["director", "vod_director"]),
                vod_play_url: getTagValue(v, ["vod_play_url"])
            };
            const movie = mapJsonToMovie(movieData, apiHost, picDomain);
            if (!movie.vod_play_url) {
                const dl = v.getElementsByTagName("dl")[0];
                if (dl) {
                    const dds = dl.getElementsByTagName("dd");
                    const parts = [];
                    for(let j=0; j<dds.length; j++) {
                        const text = dds[j].textContent;
                        if(text) parts.push(text.trim());
                    }
                    if (parts.length > 0) movie.vod_play_url = parts.join("$$$");
                }
            }
            if (movie.title) videos.push(movie);
        }

        const categories: Category[] = [];
        const classTags = xmlDoc.getElementsByTagName("class");
        if (classTags.length > 0) {
            const tyTags = classTags[0].getElementsByTagName("ty");
            for (let i = 0; i < tyTags.length; i++) {
                const id = tyTags[i].getAttribute("id");
                const name = tyTags[i].textContent;
                if (id && name) categories.push({ id, name });
            }
        }
        return { videos, categories };
    } catch (e) { 
        return { videos: [], categories: [] };
    }
};

const DEFAULT_SOURCES = [
  {
    "key": "茅台资源站采集接口",
    "name": "茅台资源站采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://caiji.maotaizy.cc/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "旺旺资源网采集接口",
    "name": "旺旺资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.wwzy.tv/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "如意资源网采集接口",
    "name": "如意资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://cj.rycjapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "红牛云播资源采集地址",
    "name": "红牛云播资源采集地址",
    "api": "https://cfkua.wokaotianshi.eu.org/https://www.hongniuzy2.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "光速资源站采集接口地址",
    "name": "光速资源站采集接口地址",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.guangsuapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "速播资源采集规则地址",
    "name": "速播资源采集规则地址",
    "api": "https://cfkua.wokaotianshi.eu.org/https://subocj.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "豪华资源网采集接口地址",
    "name": "豪华资源网采集接口地址",
    "api": "https://cfkua.wokaotianshi.eu.org/https://hhzyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "虎牙资源采集网采集接口",
    "name": "虎牙资源采集网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://www.huyaapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "爱奇艺资源站采集接口",
    "name": "爱奇艺资源站采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://iqiyizyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "豆瓣资源采集站采集接口大全",
    "name": "豆瓣资源采集站采集接口大全",
    "api": "https://cfkua.wokaotianshi.eu.org/https://caiji.dbzy5.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "魔都动漫资源采集网采集接口",
    "name": "魔都动漫资源采集网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://www.mdzyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "ikun资源网采集接口",
    "name": "ikun资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://ikunzyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "OK资源采集网采集接口",
    "name": "OK资源采集网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/http://api.okzyw.net/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "U酷资源网采集地址",
    "name": "U酷资源网采集地址",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.ukuapi88.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "量子资源网资源采集接口",
    "name": "量子资源网资源采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://cj.lziapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "最大资源网采集接口",
    "name": "最大资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.zuidapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "天涯影视资源网采集接口",
    "name": "天涯影视资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://tyyszyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "电影天堂采集综合资源接口",
    "name": "电影天堂采集综合资源接口",
    "api": "https://cfkua.wokaotianshi.eu.org/http://caiji.dyttzyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "百度资源采集接口",
    "name": "百度资源采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.apibdzy.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "百万资源网采集接口",
    "name": "百万资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.bwzyz.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "鸭鸭（丫丫）资源网采集接口",
    "name": "鸭鸭（丫丫）资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://cj.yayazy.net/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "牛牛资源网采集接口",
    "name": "牛牛资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.niuniuzy.me/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "360资源站采集接口",
    "name": "360资源站采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://360zyzz.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "卧龙影视资源采集站采集接口",
    "name": "卧龙影视资源采集站采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://collect.wolongzy.cc/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "极速资源网采集接口",
    "name": "极速资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://jszyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "暴风资源网采集接口",
    "name": "暴风资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://bfzyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "非凡资源网采集接口",
    "name": "非凡资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/http://api.ffzyapi.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "樱花资源网采集接口",
    "name": "樱花资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://m3u8.apiyhzy.com/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  },
  {
    "key": "无尽资源网采集接口",
    "name": "无尽资源网采集接口",
    "api": "https://cfkua.wokaotianshi.eu.org/https://api.wujinapi.me/api.php/provide/vod/at/xml",
    "useInSearchAll": true
  }
];

export const fetchSources = async (): Promise<Source[]> => {
  return DEFAULT_SOURCES.map((item: any) => ({ name: item.name, api: item.api }));
};

export const fetchVideoList = async (apiUrl: string, typeId: string = '', page: number = 1): Promise<{ videos: Movie[], categories: Category[] }> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    
    const listUrl = `${apiUrl}${separator}ac=list`;
    const detailUrl = `${apiUrl}${separator}ac=detail&pg=${page}${typeId ? `&t=${typeId}` : ''}`;

    const [listContent, detailContent] = await Promise.all([
        fetchViaProxy(listUrl).catch(() => ""),
        fetchViaProxy(detailUrl).catch(() => "")
    ]);

    let categories: Category[] = [];
    let videos: Movie[] = [];

    if (listContent) {
        try {
            if (listContent.trim().startsWith('{')) {
                const data = JSON.parse(listContent);
                categories = (data.class || []).map((c: any) => ({ 
                    id: (c.type_id || c.id || '').toString(), 
                    name: (c.type_name || c.name || '') 
                })).filter((c: any) => c.id && c.name);
            } else if (listContent.trim().startsWith('<')) {
                categories = parseMacCMSXml(listContent, apiHost).categories;
            }
        } catch (e) { }
    }

    if (detailContent) {
        try {
            if (detailContent.trim().startsWith('{')) {
                const data = JSON.parse(detailContent);
                const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
                videos = (data.list || []).map((v: any) => mapJsonToMovie(v, apiHost, picDomain));
            } else if (detailContent.trim().startsWith('<')) {
                videos = parseMacCMSXml(detailContent, apiHost).videos;
            }
        } catch (e) { }
    }

    return { videos, categories };
  } catch (error) {
    return { videos: [], categories: [] };
  }
};

export const searchVideos = async (apiUrl: string, query: string, signal?: AbortSignal): Promise<Movie[]> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    const targetUrl = `${apiUrl}${separator}ac=detail&wd=${encodeURIComponent(query)}`;
    const content = await fetchViaProxy(targetUrl, signal);
    
    if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
        return (data.list || []).map((v: any) => mapJsonToMovie(v, apiHost, picDomain));
    }
    const { videos } = parseMacCMSXml(content, apiHost);
    return videos;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
};

export const fetchVideoDetails = async (apiUrl: string, ids: string): Promise<Movie | null> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    const targetUrl = `${apiUrl}${separator}ac=detail&ids=${ids}`;
    const content = await fetchViaProxy(targetUrl);
    
    if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
        if (data.list && data.list.length > 0) return mapJsonToMovie(data.list[0], apiHost, picDomain);
    }
    const { videos } = parseMacCMSXml(content, apiHost);
    return videos.length > 0 ? videos[0] : null;
  } catch (error) {
    return null;
  }
};

export const parsePlayUrl = (urlStr: string) => {
  if (!urlStr) return [];
  const playerRawLists = urlStr.split('$$$');
  const candidates = playerRawLists.map(rawList => {
      return rawList.split('#').map(ep => {
          const trimmed = ep.trim();
          if (!trimmed) return null;
          let name = '正片', url = '';
          const splitIdx = trimmed.indexOf('$');
          if (splitIdx > -1) {
              name = trimmed.substring(0, splitIdx);
              url = trimmed.substring(splitIdx + 1);
          } else {
              url = trimmed;
          }
          url = url.trim();
          if (url.startsWith('//')) url = 'https:' + url;
          return { name: name.trim(), url };
      }).filter((item): item is {name: string, url: string} => 
          !!item && !!item.url && (item.url.startsWith('http') || item.url.startsWith('https'))
      );
  });
  let bestList = candidates.find(list => list.some(ep => ep.url.includes('.m3u8'))) || 
                 candidates.find(list => list.some(ep => ep.url.includes('.mp4'))) || 
                 candidates.find(list => list.length > 0);
  return bestList || [];
};
