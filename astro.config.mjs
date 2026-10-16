// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://kevin-dong.com',
  prefetch: true,
  // the world used to live at /world; it is the landing page now
  redirects: { '/world': '/' },
});
