import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '후기 모의 검수',
  version: '0.1.0',
  action: { default_popup: 'src/popup/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    {
      matches: [
        'https://admin.fastlane.kr/posts/reviews',
        'https://admin.fastlane.kr/posts/reviews?*',
      ],
      js: ['src/content/list/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://admin.fastlane.kr/posts/reviews/detail/*'],
      js: ['src/content/detail/index.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage'],
});
