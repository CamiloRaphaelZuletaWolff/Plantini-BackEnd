import type { MulterModuleOptions } from '@nestjs/platform-express';

/**
 * Maximum prompt length (characters). Matches MAX_PROMPT_LENGTH in the
 * frontend chat client; bigger prompts are rejected with 400 before they
 * reach Gemini (cost/DoS control).
 */
export const MAX_PROMPT_LENGTH = 8000;

/** Image prompts are short descriptions; keep them tighter. */
export const MAX_IMAGE_PROMPT_LENGTH = 2000;

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
    // Text fields (prompt, chatId). Multer's default is 1 MB per field and
    // unlimited fields; the DTOs only accept a couple of short fields.
    fields: 10,
    fieldSize: 64 * 1024,
    parts: MAX_UPLOAD_FILES + 10,
  },
};
