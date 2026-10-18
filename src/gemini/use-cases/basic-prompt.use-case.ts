import { GoogleGenAI } from '@google/genai';
import { BasicPromptDto } from '../dtos/basic-prompt.dto';
import { geminiUploadFiles } from '../helpers/gemini-upload-file';
import {
  InputStep,
  uploadedFileToContentPart,
} from '../types/interaction-input';

interface Options {
  model?: string;
  systemInstruction?: string;
}

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_SYSTEM_INSTRUCTION = `
  Responde únicamente en español
  En formato markdown
  Usa negritas de esta forma __
  Usa el sistema métrico decimal
`;

export const basicPromptUseCase = async (
  ai: GoogleGenAI,
  basicPromptDto: BasicPromptDto,
  options?: Options,
): Promise<string> => {
  const { prompt, files = [] } = basicPromptDto;
  const uploadedFiles = await geminiUploadFiles(ai, files);

  const {
    model = DEFAULT_MODEL,
    systemInstruction = DEFAULT_SYSTEM_INSTRUCTION,
  } = options ?? {};

  const input: InputStep[] = [
    {
      type: 'user_input',
      content: [
        { type: 'text', text: prompt },
        ...uploadedFiles.map(uploadedFileToContentPart),
      ],
    },
  ];

  const interaction = await ai.interactions.create({
    model,
    system_instruction: systemInstruction,
    input,
  });

  return interaction.output_text ?? '';
};
