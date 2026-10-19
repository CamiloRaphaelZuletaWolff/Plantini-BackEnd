import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { MAX_PROMPT_LENGTH } from '../helpers/upload-limits';

export class ChatPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PROMPT_LENGTH)
  prompt: string;

  @IsArray()
  @IsOptional()
  files: Express.Multer.File[];

  @IsUUID()
  chatId: string;
}
