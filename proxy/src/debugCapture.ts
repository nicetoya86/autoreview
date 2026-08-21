import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { guessMimeType, MIME_EXT } from './mime';

/**
 * DEBUG_CAPTURE_DIR이 설정된 로컬 개발 환경에서만, 요청받은 후기 내용/사진/판정 결과를
 * 디스크에 저장한다 — 오검수 원인 분석 시 사용자가 매번 캡쳐/복붙하지 않아도 되게 하기 위함.
 * 저장 실패는 실제 응답에 영향을 주지 않는다.
 */
export interface DebugCaptureMeta {
  author?: string;
  hospital_name?: string;
  written_at?: string;
  event_info?: string;
  duplicate_flags?: unknown;
}

export async function saveDebugCapture(
  review_id: string | undefined,
  review_type: string,
  content_text: string,
  photos: Array<{ url: string }>,
  photoBuffers: Buffer[],
  judgment: unknown,
  meta?: DebugCaptureMeta
): Promise<void> {
  const dir = process.env.DEBUG_CAPTURE_DIR;
  if (!dir) return;

  try {
    const label = new Date().toISOString().replace(/[:.]/g, '-') + (review_id ? `_${review_id}` : '');
    const caseDir = join(dir, label);
    await mkdir(caseDir, { recursive: true });
    await writeFile(
      join(caseDir, 'review.json'),
      JSON.stringify(
        { review_id, review_type, content_text, photo_urls: photos.map((p) => p.url), ...meta, judgment },
        null,
        2
      )
    );
    await Promise.all(
      photoBuffers.map((buf, i) =>
        writeFile(join(caseDir, `photo-${i}.${MIME_EXT[guessMimeType(photos[i].url)]}`), buf)
      )
    );
  } catch (err) {
    console.error('[debug-capture] save failed:', err);
  }
}
