import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '후기 모의 검수',
  version: '0.1.0',
  action: { default_title: '후기 모의 검수' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    {
      matches: [
        'https://admin.fastlane.kr/posts/reviews',
        'https://admin.fastlane.kr/posts/reviews?*',
        'https://admin.fastlane.kr/posts/reviews/*',
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
  // 후기 사진 재업로드 시 CDN이 새 URL을 발급해도 실제 이미지 바이트를 해시해
  // 중복 여부를 비교하려면 이 CDN 도메인에 대해 CORS 없이 fetch할 권한이 필요하다.
  host_permissions: ['https://dd1pyb8167x99.cloudfront.net/*'],
});
