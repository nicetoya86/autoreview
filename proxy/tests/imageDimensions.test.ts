import { describe, it, expect } from 'vitest';
import { getImageDimensions } from '../src/imageDimensions';

describe('getImageDimensions', () => {
  it('PNG IHDR에서 width/height를 읽는다', () => {
    const buf = Buffer.alloc(33);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
    buf.writeUInt32BE(13, 8); // IHDR length
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(800, 16); // width
    buf.writeUInt32BE(600, 20); // height

    expect(getImageDimensions(buf)).toEqual({ width: 800, height: 600 });
  });

  it('JPEG SOF0 세그먼트에서 width/height를 읽는다', () => {
    const buf = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xc0, // SOF0
      0x00, 0x08, // segment length (unused by parser)
      0x08, // precision
      0x02, 0x58, // height = 600
      0x03, 0x20, // width = 800
      0x00,
    ]);

    expect(getImageDimensions(buf)).toEqual({ width: 800, height: 600 });
  });

  it('JPEG에서 SOF 앞에 다른 마커(APP0)가 있어도 건너뛰고 찾는다', () => {
    const buf = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, // APP0
      0x00, 0x04, // length = 4 (length field 2바이트 자신 포함 + payload 2바이트)
      0x00, 0x00, // payload (2바이트, length=4에 맞춰야 함)
      0xff, 0xc0, // SOF0
      0x00, 0x08,
      0x08,
      0x00, 0x64, // height = 100
      0x00, 0xc8, // width = 200
      0x00,
    ]);

    expect(getImageDimensions(buf)).toEqual({ width: 200, height: 100 });
  });

  it('지원하지 않는 포맷이거나 파싱 불가하면 null', () => {
    expect(getImageDimensions(Buffer.from([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF
    expect(getImageDimensions(Buffer.alloc(2))).toBeNull();
  });
});
