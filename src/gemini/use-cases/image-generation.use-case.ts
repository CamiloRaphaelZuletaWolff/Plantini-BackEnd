import {
  ContentListUnion,
  createPartFromUri,
  GoogleGenAI,
  Modality,
} from '@google/genai';
import { v4 as uuidV4 } from 'uuid';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

import { geminiUploadFiles } from '../helpers/gemini-upload-file';
import { ImageGenerationDto } from '../dtos/image-generation.dto';

const AI_IMAGES_BUCKET = 'ai-images';

const logger = new Logger('ImageGenerationUseCase');

interface Options {
  model?: string;
  supabase: SupabaseClient;
}

export interface ImageGenerationResponse {
  imageUrl: string;
  text: string;
}

export const imageGenerationUseCase = async (
  ai: GoogleGenAI,
  imageGenerationDto: ImageGenerationDto,
  options: Options,
): Promise<ImageGenerationResponse> => {
  const { prompt, files = [] } = imageGenerationDto;
  const contents: ContentListUnion = [{ text: prompt }];

  const uploadedFiles = await geminiUploadFiles(ai, files, {
    transformToPng: true,
  });

  uploadedFiles.forEach((file) => {
    contents.push(createPartFromUri(file.uri ?? '', file.mimeType ?? ''));
  });

  const { model = 'gemini-2.0-flash-exp-image-generation', supabase } = options;

  const response = await ai.models.generateContent({
    model: model,
    contents: contents,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  let imageUrl = '';
  let text = '';
  const imageId = uuidV4();

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) {
      text = part.text;
      continue;
    }
    if (!part.inlineData) {
      continue;
    }

    const imageData = part.inlineData.data!;
    const buffer = Buffer.from(imageData, 'base64');
    const fileName = `${imageId}.png`;

    const { error: uploadError } = await supabase.storage
      .from(AI_IMAGES_BUCKET)
      .upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) {
      logger.error(
        'No se pudo subir la imagen generada a Supabase Storage',
        uploadError.message,
      );
      throw new InternalServerErrorException(
        'No se pudo guardar la imagen generada',
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(AI_IMAGES_BUCKET).getPublicUrl(fileName);

    imageUrl = publicUrl;
  }

  return { imageUrl, text };
};
