import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const output = resolve(root, 'dist');

function copySiteAssets() {
  return {
    name: 'copy-site-assets',
    apply: 'build',
    closeBundle() {
      const files = [
        'assets/data/story-data.js',
        'assets/js/factory-scene.js',
        'assets/js/runtime.js',
        'assets/js/story-timeline.js',
        'assets/vendor/react.production.min.js',
        'assets/vendor/react-dom.production.min.js',
        'assets/vendor/three/three.core.min.js',
        'assets/vendor/three/three.module.min.js',
        'assets/design-system/industry-b2b80fb0-7acd-48a9-918c-f807f0870b36/styles.css',
      ];

      for (const file of files) {
        const target = resolve(output, file);
        mkdirSync(resolve(target, '..'), { recursive: true });
        cpSync(resolve(root, file), target);
      }

      const images = resolve(root, 'assets/images');
      for (const image of readdirSync(images, { withFileTypes: true })) {
        if (!image.isFile()) continue;
        const target = resolve(output, 'assets/images', image.name);
        mkdirSync(resolve(target, '..'), { recursive: true });
        cpSync(resolve(images, image.name), target);
      }

      cpSync(resolve(root, '.nojekyll'), resolve(output, '.nojekyll'));
    },
  };
}

function mountProjectPreview() {
  return {
    name: 'mount-project-preview',
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === '/Lab-Website' || request.url?.startsWith('/Lab-Website/')) {
          request.url = request.url.slice('/Lab-Website'.length) || '/';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [copySiteAssets(), mountProjectPreview()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(root, 'index.html') },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
