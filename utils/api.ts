import { Movie, Category, Source } from '../types';

// Define proxy configurations with their URL construction strategy
interface ProxyConfig {
  url: string;
  type: 'append' | 'query';
}

// Optimized Proxy List - 仅用于 API 请求，不用于图片
const PROXIES: ProxyConfig[] = [
  { url: '/api/proxy?url=', type: 'query' },
  { url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'query' },
  { url: 'https://api.allorigins.win/raw?url=', type: 'query' },
  { url: 'https://corsproxy.io/?', type: 'append' },
];

// Helper to fetch through proxy with fallback
const fetchViaProxy = async (targetUrl: string): Promise<string> => {
  let lastError;
  for (const proxy of PROXIES) {
    try {
      let url = proxy.type === 'query' ? `${proxy.url}${encodeURIComponent(targetUrl)}` : `${proxy.url}${targetUrl}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); 
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const text = await response.text();
            return text;
        }
        throw new Error(`Status ${response.status}`);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        continue;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to fetch ${targetUrl}`);
};

// --- Helpers ---

/**
 * 提取 API 的基础域名
 */
const getBaseHost = (apiUrl: string): string => {
    try {
        const url = new URL(apiUrl);
        return `${url.protocol}//${url.host}`;
    } catch (e) {
        return "";
    }
};

/**
 * 清理并格式化图片 URL
 * @param url 原始图片路径
 * @param apiHost API 域名
 * @param providedDomain API 响应中可能提供的图片专用域名
 */
const formatImageUrl = (url: string, apiHost: string, providedDomain?: string): string => {
    if (!url) return "";
    let cleaned = url.trim();
    
    // 如果是完整的 http/https 链接，直接返回
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
        return cleaned;
    }

    // 处理协议相对路径 //
    if (cleaned.startsWith('//')) {
        return 'https:' + cleaned;
    }

    // 处理相对路径 /upload/...
    if (cleaned.startsWith('/')) {
        const domain = (providedDomain || apiHost).replace(/\/$/, '');
        return domain + cleaned;
    }
    
    // 处理无斜杠开头的相对路径 upload/...
    if (!cleaned.includes('://')) {
        const domain = (providedDomain || apiHost).replace(/\/$/, '');
        return domain + '/' + cleaned;
    }

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

// 统一映射 JSON 对象到 Movie 类型
const mapJsonToMovie = (v: any, apiHost: string, picDomain?: string): Movie => ({
    id: (v.vod_id || v.id || '').toString(),
    vod_id: v.vod_id,
    title: v.vod_name || v.name || '',
    image: formatImageUrl(v.vod_pic || v.pic || v.vod_img || v.vod_pic_thumb || '', apiHost, picDomain),
    genre: v.type_name || v.type || '',
    year: v.vod_year || v.year || new Date().getFullYear().toString(),
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
        const videoTags = xmlDoc.getElementsByTagName("video"); 
        
        // 尝试从 XML 中提取图片域名 (部分接口在 list 标签上)
        const listTag = xmlDoc.getElementsByTagName("list")[0];
        const picDomain = listTag?.getAttribute("pic_domain") || listTag?.getAttribute("vod_pic_domain") || undefined;
        
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
        const classTag = xmlDoc.getElementsByTagName("class")[0];
        if (classTag) {
            const tyTags = classTag.getElementsByTagName("ty");
            for (let i = 0; i < tyTags.length; i++) {
                const id = tyTags[i].getAttribute("id");
                const name = tyTags[i].textContent;
                if (id && name) categories.push({ id, name });
            }
        }
        return { videos, categories };
    } catch (e) { throw e; }
};

export const fetchSources = async (): Promise<Source[]> => {
  const fallbackSources = [
      { name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod/' }, 
      { name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod/' },
      { name: '天空资源', api: 'https://api.tiankongapi.com/api.php/provide/vod/' }
  ];
  try {
    const targetUrl = 'https://a.wokaotianshi.eu.org/jgcj/zyvying.json';
    const jsonText = await fetchViaProxy(targetUrl);
    const data = JSON.parse(jsonText);
    if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({ name: item.name, api: item.api }));
    }
    return fallbackSources;
  } catch (error) {
    return fallbackSources;
  }
};

export const fetchVideoList = async (apiUrl: string, typeId: string = '', page: number = 1): Promise<{ videos: Movie[], categories: Category[] }> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    let targetUrl = `${apiUrl}${separator}ac=list&pg=${page}`;
    if (typeId) targetUrl += `&t=${typeId}`;
    const content = await fetchViaProxy(targetUrl);
    
    try {
        if (content.trim().startsWith('{')) {
            const data = JSON.parse(content);
            // 提取 JSON 中可能的专用图片域名
            const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
            
            const categories: Category[] = (data.class || []).map((c: any) => ({ id: (c.type_id || c.id).toString(), name: (c.type_name || c.name) }));
            const videos: Movie[] = (data.list || []).map((v: any) => mapJsonToMovie(v, apiHost, picDomain));
            return { videos, categories };
        }
    } catch(e) {}
    return parseMacCMSXml(content, apiHost);
  } catch (error) {
    return { videos: [], categories: [] };
  }
};

export const searchVideos = async (apiUrl: string, query: string): Promise<Movie[]> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    const targetUrl = `${apiUrl}${separator}ac=list&wd=${encodeURIComponent(query)}`;
    const content = await fetchViaProxy(targetUrl);
    try {
      if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
        return (data.list || []).map((v: any) => mapJsonToMovie(v, apiHost, picDomain));
      }
    } catch (e) {}
    const { videos } = parseMacCMSXml(content, apiHost);
    return videos;
  } catch (error) {
    return [];
  }
};

export const fetchVideoDetails = async (apiUrl: string, ids: string): Promise<Movie | null> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    const targetUrl = `${apiUrl}${separator}ac=detail&ids=${ids}`;
    const content = await fetchViaProxy(targetUrl);
    try {
        if (content.trim().startsWith('{')) {
            const data = JSON.parse(content);
            const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
            if (data.list && data.list.length > 0) return mapJsonToMovie(data.list[0], apiHost, picDomain);
        }
    } catch(e) {}
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