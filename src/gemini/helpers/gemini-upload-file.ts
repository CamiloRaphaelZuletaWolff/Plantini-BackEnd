// Ensures Express.Multer namespace augmentation is loaded by TypeScript
import 'multer';

import { BadRequestException, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

import { MAX_UPLOAD_FILE_BYTES } from './upload-limits';

/**
 * The only file types the chat accepts: common raster images and PDF.
 * SVG and Office documents are rejected on purpose (SVG can carry scripts
 * and is parsed by librsvg inside sharp; Office files are not needed).
 */
const fileMimeTypesByExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/** Non-standard aliases some clients send, mapped to the canonical type. */
const mimeTypeAliases: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
};

interface UploadFileOptions {
  transformToPng?: boolean;
  maxFileSizeBytes?: number;
}

// Same per-file cap that Multer enforces at the HTTP boundary.
const DEFAULT_MAX_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_BYTES;
const allowedMimeTypes = new Set(Object.values(fileMimeTypesByExtension));
const logger = new Logger('GeminiUploadFile');

const startsWithBytes = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, index) => buffer[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * Detects the real type from the file's first bytes ("magic numbers").
 * The client-provided mimetype and extension are trivially spoofable, so the
 * content must match an allowed signature too.
 */
export const sniffMimeType = (buffer: Buffer | undefined): string | null => {
  if (!buffer || buffer.length < 4) return null;
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (startsWithBytes(buffer, ascii('GIF8'))) return 'image/gif';
  if (
    startsWithBytes(buffer, ascii('RIFF')) &&
    startsWithBytes(buffer, ascii('WEBP'), 8)
  )
    return 'image/webp';
  if (startsWithBytes(buffer, ascii('%PDF-'))) return 'application/pdf';
  if (startsWithBytes(buffer, ascii('ftyp'), 4)) {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(brand))
      return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
  }
  return null;
};

const resolveMimeType = (file: Express.Multer.File) => {
  const fileExtension = file.originalname.split('.').pop() ?? '';
  const fallbackMimeType =
    fileMimeTypesByExtension[fileExtension.toLowerCase()] ?? '';
  const providedMimeType = (file.mimetype ?? '').toLowerCase();

  if (
    providedMimeType &&
    !providedMimeType.includes('application/octet-stream')
  ) {
    return mimeTypeAliases[providedMimeType] ?? providedMimeType;
  }

  return fallbackMimeType || providedMimeType;
};

const isSameFamily = (declared: string, sniffed: string) =>
  declared === sniffed ||
  // HEIC/HEIF brands overlap; treat them as one family.
  (declared.startsWith('image/hei') && sniffed.startsWith('image/hei'));

export const ensureFileIsAllowed = (
  file: Express.Multer.File,
  maxFileSizeBytes: number = DEFAULT_MAX_FILE_SIZE_BYTES,
) => {
  if (file.size > maxFileSizeBytes) {
    throw new BadRequestException(
      'El archivo excede el tamaño máximo permitido',
    );
  }

  const mimeType = resolveMimeType(file);
  const sniffedMimeType = sniffMimeType(file.buffer);

  if (
    !mimeType ||
    !allowedMimeTypes.has(mimeType) ||
    !sniffedMimeType ||
    !isSameFamily(mimeType, sniffedMimeType)
  ) {
    throw new BadRequestException('Tipo de archivo no soportado');
  }

  return mimeType;
};

export const geminiUploadFiles = async (
  ai: GoogleGenAI,
  files: Express.Multer.File[],
  options: UploadFileOptions = {},
) => {
  const { transformToPng, maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES } =
    options;

  if (!files?.length) {
    return [];
  }

  if (transformToPng) {
    const pngUploadedFiles = await Promise.all(
      files.map(async (file) => {
        ensureFileIsAllowed(file, maxFileSizeBytes);

        try {
          const buffer = await sharp(file.buffer).png().toBuffer();

          return ai.files.upload({
            file: new Blob([buffer], {
              type: 'image/png',
            }),
          });
        } catch {
          logger.warn(
            `No se pudo transformar a PNG un archivo de ${file.size} bytes`,
          );
          throw new BadRequestException(
            'No se pudo procesar la imagen, verifica que el archivo sea válido',
          );
        }
      }),
    );

    return pngUploadedFiles;
  }

  const uploadedFiles = await Promise.all(
    files.map((file) => {
      const mimeType = ensureFileIsAllowed(file, maxFileSizeBytes);

      return ai.files.upload({
        file: new Blob([file.buffer], {
          type: mimeType,
        }),
      });
    }),
  );

  return uploadedFiles;
};
