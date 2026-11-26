// @ts-check
import { createRequire } from 'node:module';
import { defineConfig } from 'astro/config';

// In a git worktree under the main checkout, the dependencies are not in the worktree but in the main checkout's node_modules, found by
// walking up from it. Vite resolves the fonts in it to a path outside the worktree and refuses to serve them ("outside of Vite serving
// allow list"). So the folder the dependencies really are in goes on the allow list: it is wherever `astro` resolves to. In the main
// checkout that is just ./node_modules, which was allowed already.
const entry = createRequire(import.meta.url).resolve('astro/config');
const nodeModules = entry.slice(0, entry.lastIndexOf('node_modules') + 'node_modules'.length);

// https://astro.build/config
export default defineConfig({
  site: 'https://kevin-dong.com',
  prefetch: true,
  // the world used to live at /world; it is the landing page now
  redirects: { '/world': '/' },
  vite: { server: { fs: { allow: [process.cwd(), nodeModules] } } },
});
