import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { MAX_IMAGE_PROMPT_LENGTH } from '../helpers/upload-limits';

export class ImageGenerationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_IMAGE_PROMPT_LENGTH)
  prompt: string;

  @IsArray()
  @IsOptional()
  files: Express.Multer.File[];
}
