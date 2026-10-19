import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { MAX_PROMPT_LENGTH } from '../helpers/upload-limits';

export class BasicPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PROMPT_LENGTH)
  prompt: string;

  @IsArray()
  @IsOptional()
  files: Express.Multer.File[];
}
