import { Movie, Category, Source } from '../types';

// Define proxy configurations with their URL construction strategy
interface ProxyConfig {
  url: string;
  type: 'append' | 'query';
}

// Optimized Proxy List
const PROXIES: ProxyConfig[] = [
  // Priority 1: Vercel Serverless Proxy (Local) - Best for Mixed Content & Stability
  { url: '/api/proxy?url=', type: 'query' },
  // Priority 2: CORS Proxy IO (Fast External)
  { url: 'https://corsproxy.io/?', type: 'append' },
  // Priority 3: AllOrigins (External Backup)
  { url: 'https://api.allorigins.win/raw?url=', type: 'query' },
];

// Helper to fetch through proxy with fallback
const fetchViaProxy = async (targetUrl: string): Promise<string> => {
  let lastError;
  
  // 1. Try Direct Fetch first
  try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout for direct
      const response = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (response.ok) {
          const text = await response.text();
          if (text.trim().startsWith('{') || text.trim().startsWith('<')) {
              return text;
          }
      }
  } catch (e) {}

  // 2. Try Proxies
  for (const proxy of PROXIES) {
    try {
      let url;
      if (proxy.type === 'query') {
          url = `${proxy.url}${encodeURIComponent(targetUrl)}`;
      } else {
          url = `${proxy.url}${targetUrl}`;
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
          controller.abort(); 
      }, 5000); 
      
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const text = await response.text();
            const trimmed = text.trim().toLowerCase();
            if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
                throw new Error('Proxy returned HTML error page instead of data');
            }
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

/**
 * Format Image URL
 * Standardizes protocol and removes CMS variables.
 */
const formatImageUrl = (url: any): string => {
    if (!url || typeof url !== 'string') return '';
    let cleanUrl = url.trim();
    
    // Remove CMS variables like {mac_url}
    cleanUrl = cleanUrl.replace(/\{mac_url\}/gi, '');
    
    // Handle Protocol Relative
    if (cleanUrl.startsWith('//')) {
        return `https:${cleanUrl}`;
    }
    
    // If it's a relative path (unlikely in most CMS but possible), keep it as is 
    // but ensure it's not just a filename.
    return cleanUrl;
};

/**
 * Extract image from item
 * DIRECTLY extracts vod_pic as requested by the user.
 */
const extractImage = (item: any): string => {
    // Priority 1: Direct vod_pic field
    if (item.vod_pic && typeof item.vod_pic === 'string' && item.vod_pic.length > 5) {
        return formatImageUrl(item.vod_pic);
    }
    
    // Priority 2: Alternative common fields
    const fallback = item.vod_pic_thumb || item.vod_img || item.pic || item.img || item.picture;
    if (fallback && typeof fallback === 'string' && fallback.length > 5) {
        return formatImageUrl(fallback);
    }

    return '';
};

// --- XML Parsing Helpers ---

const getTagValue = (element: Element, tagNames: string[]): string => {
    for (const tag of tagNames) {
        const el = element.getElementsByTagName(tag)[0];
        if (el && el.textContent) return el.textContent.trim();
    }
    return "";
};

const sanitizeXml = (xml: string): string => {
    if (!xml) return "";
    return xml
        .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
};

const parseMacCMSXml = (xmlText: string) => {
    try {
        const cleanXml = sanitizeXml(xmlText);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");
        
        const videos: Movie[] = [];
        const videoTags = xmlDoc.getElementsByTagName("video"); 
        
        for (let i = 0; i < videoTags.length; i++) {
            const v = videoTags[i];
            const id = getTagValue(v, ["id", "vod_id"]);
            const name = getTagValue(v, ["name", "vod_name"]);
            const rawPic = getTagValue(v, ["pic", "vod_pic", "img", "vod_img"]);
            const pic = formatImageUrl(rawPic);

            const type = getTagValue(v, ["type", "type_name"]);
            const year = getTagValue(v, ["year", "vod_year"]);
            const note = getTagValue(v, ["note", "vod_remarks"]);
            const content = getTagValue(v, ["des", "vod_content"]);
            const actor = getTagValue(v, ["actor", "vod_actor"]);
            const director = getTagValue(v, ["director", "vod_director"]);
            
            let playUrl = getTagValue(v, ["vod_play_url"]);
            if (!playUrl || playUrl.length < 5) {
                const dl = v.getElementsByTagName("dl")[0];
                if (dl) {
                    const dds = dl.getElementsByTagName("dd");
                    const parts = [];
                    for(let j=0; j<dds.length; j++) {
                        const text = dds[j].textContent;
                        if(text) parts.push(text.trim());
                    }
                    if (parts.length > 0) playUrl = parts.join("$$$");
                }
            }

            if (name) {
                videos.push({
                    id,
                    vod_id: id,
                    title: name,
                    image: pic,
                    genre: type,
                    year: year || new Date().getFullYear().toString(),
                    badge: note,
                    badgeColor: 'black',
                    vod_content: content,
                    vod_actor: actor,
                    vod_director: director,
                    vod_play_url: playUrl
                });
            }
        }

        const categories: Category[] = [];
        const classTag = xmlDoc.getElementsByTagName("class")[0];
        if (classTag) {
            const tyTags = classTag.getElementsByTagName("ty");
            for (let i = 0; i < tyTags.length; i++) {
                const id = tyTags[i].getAttribute("id");
                const name = tyTags[i].textContent;
                if (id && name) {
                    categories.push({ id, name });
                }
            }
        }

        return { videos, categories };
    } catch (e) {
        throw e;
    }
};

// Fetch Sources List
export const fetchSources = async (): Promise<Source[]> => {
  const fallbackSources = [
      { name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod/' }, 
      { name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod/' },
      { name: '天空资源', api: 'https://api.tiankongapi.com/api.php/provide/vod/' },
      { name: '默认资源', api: 'https://caiji.maotaizy.cc/api.php/provide/vod/' }
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

// Fetch Video List
export const fetchVideoList = async (apiUrl: string, typeId: string = '', page: number = 1): Promise<{ videos: Movie[], categories: Category[] }> => {
  try {
    let targetUrl = `${apiUrl}`;
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}ac=list&pg=${page}`;
    if (typeId) targetUrl += `&t=${typeId}`;
    
    const content = await fetchViaProxy(targetUrl);
    
    if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        if(data && (data.list || data.class)) {
            const categories: Category[] = [];
            if (data.class && Array.isArray(data.class)) {
                data.class.forEach((c: any) => {
                    if (c.type_id && c.type_name) {
                        categories.push({ id: c.type_id.toString(), name: c.type_name });
                    }
                });
            }

            const results: Movie[] = [];
            const list = data.list || [];
            for (let i = 0; i < list.length; i++) {
                const v = list[i];
                if (v.vod_name) {
                    results.push({
                        id: v.vod_id.toString(),
                        vod_id: v.vod_id,
                        title: v.vod_name,
                        image: extractImage(v), 
                        genre: v.type_name || '',
                        year: v.vod_year || new Date().getFullYear().toString(),
                        badge: v.vod_remarks || '',
                        badgeColor: 'black'
                    });
                }
            }
            return { videos: results, categories };
        }
    }
    return parseMacCMSXml(content);
  } catch (error) {
    throw error;
  }
};

// Search Videos
export const searchVideos = async (apiUrl: string, query: string): Promise<Movie[]> => {
  try {
    let targetUrl = `${apiUrl}`;
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}ac=list&wd=${encodeURIComponent(query)}`;

    const content = await fetchViaProxy(targetUrl);
    
    if (content.trim().startsWith('{')) {
      const data = JSON.parse(content);
      if (data && data.list) {
          return data.list.map((item: any) => ({
              id: item.vod_id.toString(),
              vod_id: item.vod_id,
              title: item.vod_name,
              image: extractImage(item),
              genre: item.type_name || '其他',
              year: item.vod_year || '',
              badge: item.vod_remarks || 'HD',
              badgeColor: 'primary'
          }));
      }
    }
    const { videos } = parseMacCMSXml(content);
    return videos;
  } catch (error) {
    return [];
  }
};

// Get Video Details
export const fetchVideoDetails = async (apiUrl: string, ids: string): Promise<Movie | null> => {
  try {
    let targetUrl = `${apiUrl}`;
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}ac=detail&ids=${ids}`;

    const content = await fetchViaProxy(targetUrl);
    
    if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        if (data && data.list && data.list.length > 0) {
            const item = data.list[0];
            return {
                id: item.vod_id.toString(),
                vod_id: item.vod_id,
                title: item.vod_name,
                image: extractImage(item),
                genre: item.type_name,
                year: item.vod_year,
                badge: item.vod_remarks,
                vod_content: item.vod_content,
                vod_actor: item.vod_actor,
                vod_director: item.vod_director,
                vod_play_url: item.vod_play_url, 
                rating: 9.0 
            };
        }
    }
    const { videos } = parseMacCMSXml(content);
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
          let name = '正片';
          let url = '';
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
      }).filter((item): item is {name: string, url: string} => !!item && !!item.url);
  });

  let bestList = candidates.find(list => list.some(ep => ep.url.includes('.m3u8')));
  if (!bestList) bestList = candidates.find(list => list.some(ep => ep.url.includes('.mp4')));
  if (!bestList) bestList = candidates.find(list => list.length > 0);
  return bestList || [];
};