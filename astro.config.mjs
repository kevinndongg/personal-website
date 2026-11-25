// @ts-check
import { realpathSync } from 'node:fs';
import { defineConfig } from 'astro/config';

// In a git worktree, node_modules is a link to the main checkout's. Vite resolves the fonts in it to their real path, which is outside
// the worktree, and refuses to serve them ("outside of Vite serving allow list"). Allowing the real path fixes that; in the main
// checkout it is just ./node_modules, which was allowed already.
const nodeModules = realpathSync('node_modules');

// https://astro.build/config
export default defineConfig({
  site: 'https://kevin-dong.com',
  prefetch: true,
  // the world used to live at /world; it is the landing page now
  redirects: { '/world': '/' },
  vite: { server: { fs: { allow: [process.cwd(), nodeModules] } } },
});
