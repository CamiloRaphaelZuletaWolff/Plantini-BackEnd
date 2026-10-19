import { BadRequestException } from '@nestjs/common';

import { ensureFileIsAllowed, sniffMimeType } from './gemini-upload-file';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const file = (
  buffer: Buffer,
  mimetype: string,
  originalname = 'file',
): Express.Multer.File =>
  ({
    buffer,
    mimetype,
    originalname,
    size: buffer.length,
  }) as Express.Multer.File;

describe('sniffMimeType', () => {
  it('detects allowed signatures', () => {
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffMimeType(PDF)).toBe('application/pdf');
  });

  it('returns null for unknown content', () => {
    expect(sniffMimeType(SVG)).toBeNull();
    expect(sniffMimeType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });
});

describe('ensureFileIsAllowed', () => {
  it('accepts an image whose bytes match its declared type', () => {
    expect(ensureFileIsAllowed(file(PNG, 'image/png'))).toBe('image/png');
    expect(ensureFileIsAllowed(file(JPEG, 'image/jpg'))).toBe('image/jpeg');
    expect(
      ensureFileIsAllowed(file(PDF, 'application/octet-stream', 'doc.pdf')),
    ).toBe('application/pdf');
  });

  it('rejects SVG even when declared as an image', () => {
    expect(() => ensureFileIsAllowed(file(SVG, 'image/svg+xml'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects content that does not match the declared type', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(() => ensureFileIsAllowed(file(html, 'image/png'))).toThrow(
      BadRequestException,
    );
    expect(() => ensureFileIsAllowed(file(PDF, 'image/png'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects files over the size limit', () => {
    expect(() => ensureFileIsAllowed(file(PNG, 'image/png'), 4)).toThrow(
      BadRequestException,
    );
  });
});
