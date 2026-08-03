import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      // popup은 action.default_popup이 아니라 chrome.windows.create()로 여는 별도 창이라
      // manifest 스캔으로는 감지되지 않는다 — 직접 entry로 지정해야 dist에 번들된다.
      input: {
        popup: 'src/popup/index.html',
      },
    },
  },
});
