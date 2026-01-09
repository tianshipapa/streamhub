
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing URL parameter' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // 针对豆瓣 API 增加 Referer，解决接口 403 问题
    if (targetUrl.includes('douban.com')) {
      headers['Referer'] = 'https://movie.douban.com/';
      headers['Host'] = 'movie.douban.com';
    }

    const response = await fetch(targetUrl, { headers });

    const data = await response.text();

    return new Response(data, {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') || 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data', details: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
