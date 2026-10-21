import { defineConfig } from 'astro/config';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const basePath = '/sound_toolbox/';
const legacyRoots = new Set([
  'digital_sampling_visualizer',
  'dsd_explained',
  'earphone_cable_impact_analyzer',
  'LICENSE',
  'masking_experience',
  'oscillator',
  'preview_audio_player',
  'sound_abx_tester',
  'vinyl_explained',
]);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.flac': 'audio/flac',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

function legacyStaticDevServer() {
  const root = process.cwd();

  return {
    name: 'legacy-static-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || !['GET', 'HEAD'].includes(request.method ?? 'GET')) {
          next();
          return;
        }

        // Vite strips the base path from request.url before this handler runs.
        const url = new URL(request.originalUrl ?? request.url, 'http://localhost');
        const relativeUrlPath = url.pathname.startsWith(basePath)
          ? url.pathname.slice(basePath.length)
          : url.pathname.replace(/^\//, '');
        let relativePath;
        try {
          relativePath = decodeURIComponent(relativeUrlPath);
        } catch {
          next();
          return;
        }
        const [topLevel] = relativePath.split('/');
        if (!topLevel || !legacyRoots.has(topLevel) || /^readme\.md$/i.test(path.basename(relativePath))) {
          next();
          return;
        }

        const filePath = path.resolve(root, relativePath);
        if (!filePath.startsWith(`${root}${path.sep}`)) {
          next();
          return;
        }
        const isDirectory = existsSync(filePath) && statSync(filePath).isDirectory();
        if (isDirectory && !url.pathname.endsWith('/')) {
          // Match GitHub Pages: relative assets in index.html need the trailing slash.
          response.statusCode = 301;
          response.setHeader('Location', `${url.pathname}/${url.search}`);
          response.end();
          return;
        }

        const htmlFilePath = path.extname(filePath) ? filePath : `${filePath}.html`;
        const staticFilePath = isDirectory
          ? path.join(filePath, 'index.html')
          : existsSync(filePath) ? filePath : htmlFilePath;
        if (!existsSync(staticFilePath)) {
          next();
          return;
        }

        const fileStat = statSync(staticFilePath);
        if (!fileStat.isFile()) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Length', fileStat.size);
        response.setHeader(
          'Content-Type',
          contentTypes[path.extname(staticFilePath).toLowerCase()] ?? 'application/octet-stream',
        );

        if (request.method === 'HEAD') {
          response.end();
          return;
        }

        createReadStream(staticFilePath).pipe(response);
      });
    },
  };
}

export default defineConfig({
  site: 'https://frieve-a.github.io',
  // Keep BASE_URL slash-terminated for asset paths with trailingSlash: 'ignore'.
  base: basePath,
  output: 'static',
  // Let legacyStaticDevServer redirect real directories before serving their assets.
  // Astro's 'always' mode rejects these requests before that middleware can run.
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [legacyStaticDevServer()],
  },
});
