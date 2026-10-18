import { GoogleGenAI } from '@google/genai';
import { v4 as uuidV4 } from 'uuid';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

import { geminiUploadFiles } from '../helpers/gemini-upload-file';
import { ImageGenerationDto } from '../dtos/image-generation.dto';
import {
  InputContentPart,
  uploadedFileToContentPart,
} from '../types/interaction-input';

const AI_IMAGES_BUCKET = 'ai-images';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

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
  const { model = DEFAULT_MODEL, supabase } = options;

  const uploadedFiles = await geminiUploadFiles(ai, files, {
    transformToPng: true,
  });

  const input: InputContentPart[] = [
    { type: 'text', text: prompt },
    ...uploadedFiles.map(uploadedFileToContentPart),
  ];

  const interaction = await ai.interactions.create({
    model,
    input,
  });

  const text = interaction.output_text ?? '';
  const generatedImage = interaction.output_image;

  if (!generatedImage?.data) {
    logger.error('La generación de imagen no devolvió contenido de imagen');
    throw new InternalServerErrorException('No se pudo generar la imagen');
  }

  const buffer = Buffer.from(generatedImage.data, 'base64');
  const fileName = `${uuidV4()}.png`;

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

  return { imageUrl: publicUrl, text };
};
