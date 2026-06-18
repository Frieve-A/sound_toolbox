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
]);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.flac': 'audio/flac',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
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

        const url = new URL(request.url, 'http://localhost');
        const relativeUrlPath = url.pathname.startsWith(basePath)
          ? url.pathname.slice(basePath.length)
          : url.pathname.replace(/^\//, '');
        const relativePath = decodeURIComponent(relativeUrlPath);
        const [topLevel] = relativePath.split('/');
        if (!topLevel || !legacyRoots.has(topLevel) || /^readme\.md$/i.test(path.basename(relativePath))) {
          next();
          return;
        }

        const filePath = path.resolve(root, relativePath);
        const htmlFilePath = path.extname(filePath) ? filePath : `${filePath}.html`;
        const staticFilePath = existsSync(filePath) ? filePath : htmlFilePath;
        if (!staticFilePath.startsWith(root) || !existsSync(staticFilePath)) {
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
  base: '/sound_toolbox',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [legacyStaticDevServer()],
  },
});
