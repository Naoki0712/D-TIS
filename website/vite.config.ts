import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pagesBase, repositoryRoot } from '../shared/vite-pages';
import { rootAssetsPlugin } from '../shared/root-assets-plugin';
export default defineConfig(({ mode }) => ({
  base: pagesBase(mode),
  envDir: repositoryRoot,
  define: { __DTIS_SITE_BASE__: JSON.stringify(pagesBase(mode)) },
  plugins: [react(), rootAssetsPlugin(pagesBase(mode))],
  build: { assetsDir: 'bundles' },
}));
