import fs from 'fs';
import https from 'https';
import path from 'path';

const files = [
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/core-js/3.37.1/minified.js', name: 'minified.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/fetch/3.6.20/fetch.min.js', name: 'fetch.min.js' },
  { url: 'https://unpkg.com/abortcontroller-polyfill/dist/abortcontroller-polyfill-only.js', name: 'abortcontroller-polyfill-only.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/url-polyfill/1.1.12/url-polyfill.min.js', name: 'url-polyfill.min.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js', name: 'hls.min.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/artplayer/5.3.0/artplayer.js', name: 'artplayer.js' },
  { url: 'https://cdn.tailwindcss.com?plugins=forms,typography,line-clamp', name: 'tailwind.js' }
];

const dir = path.join(process.cwd(), 'public', 'js');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

async function download() {
  for (const item of files) {
    const dest = path.join(dir, item.name);
    console.log(`Downloading ${item.url} to ${dest}`);
    
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(item.url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
            // Handle redirects if any
            let redirectUrl = response.headers.location!;
            if (!redirectUrl.startsWith('http')) {
                const originalUrl = new URL(item.url);
                redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
            }
            https.get(redirectUrl, (res) => {
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            }).on('error', reject);
        } else {
            response.pipe(file);
            file.on('finish', () => {
              file.close(resolve);
            });
        }
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
  }
}

download().catch(console.error);
