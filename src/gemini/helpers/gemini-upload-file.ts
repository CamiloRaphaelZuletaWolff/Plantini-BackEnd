// Ensures Express.Multer namespace augmentation is loaded by TypeScript
import 'multer';

import { BadRequestException, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

const fileMimeTypesByExtension = {
  jpg: 'image/jpg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

interface UploadFileOptions {
  transformToPng?: boolean;
  maxFileSizeBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const allowedMimeTypes = new Set(Object.values(fileMimeTypesByExtension));
const logger = new Logger('GeminiUploadFile');

const resolveMimeType = (file: Express.Multer.File) => {
  const fileExtension = file.originalname.split('.').pop() ?? '';
  const fallbackMimeType =
    fileMimeTypesByExtension[fileExtension.toLowerCase()] ?? '';
  const providedMimeType = file.mimetype;

  if (
    providedMimeType &&
    !providedMimeType.includes('application/octet-stream')
  ) {
    return providedMimeType;
  }

  if (fallbackMimeType) {
    return fallbackMimeType;
  }

  return providedMimeType;
};

const ensureFileIsAllowed = (
  file: Express.Multer.File,
  maxFileSizeBytes: number,
) => {
  if (file.size > maxFileSizeBytes) {
    throw new BadRequestException(
      'El archivo excede el tamaño máximo permitido',
    );
  }

  const mimeType = resolveMimeType(file);

  if (
    !mimeType ||
    (!mimeType.startsWith('image/') && !allowedMimeTypes.has(mimeType))
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
        } catch (error) {
          logger.warn(
            `No se pudo procesar el archivo para transformarlo a PNG: ${file.originalname}`,
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
