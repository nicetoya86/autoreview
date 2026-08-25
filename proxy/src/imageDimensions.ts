/**
 * JPEG(SOF)/PNG(IHDR) 헤더만 읽어 실제 픽셀 크기를 구한다 — 외부 이미지 라이브러리 없이
 * 저해상도 사진(용량은 작아도 실제로는 안 보이는 사진)을 판별하기 위함.
 * 지원하지 않는 포맷(webp/gif)이거나 파싱 실패 시 null을 반환한다.
 */
export function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    // PNG: IHDR 청크가 항상 8번째 바이트부터 시작, width/height는 그 안 16번째 바이트부터.
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: 마커를 순회하며 첫 SOF(Start Of Frame) 세그먼트를 찾는다.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }

  return null;
}
