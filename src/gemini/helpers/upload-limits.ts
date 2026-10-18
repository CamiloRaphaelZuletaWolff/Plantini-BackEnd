import type { MulterModuleOptions } from '@nestjs/platform-express';

/** Maximum number of files accepted in a single multipart request. */
export const MAX_UPLOAD_FILES = 4;

/** Maximum size of each uploaded file (10 MB). */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Multer options shared by every `FilesInterceptor` in the Gemini controller.
 *
 * Files are buffered in memory before being forwarded to Gemini, so these
 * limits cap the worst case at ~40 MB per request — safe on a 512 MB instance
 * (Render free). Multer aborts oversized uploads with a 413 before the
 * handler runs.
 */
export const uploadOptions: MulterModuleOptions = {
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: MAX_UPLOAD_FILE_BYTES,
  },
};
