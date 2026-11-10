import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rootAssetsPlugin } from '../shared/root-assets-plugin';
import { pagesBase, repositoryRoot } from '../shared/vite-pages';
export default defineConfig(({ mode }) => ({
  base: `${pagesBase(mode)}signage/`,
  envDir: repositoryRoot,
  define: { __DTIS_SITE_BASE__: JSON.stringify(pagesBase(mode)) },
  plugins: [react(), rootAssetsPlugin(pagesBase(mode))],
  build: { assetsDir: 'bundles' },
}));
