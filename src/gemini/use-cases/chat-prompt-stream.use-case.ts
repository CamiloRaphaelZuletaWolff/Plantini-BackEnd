import { GoogleGenAI } from '@google/genai';
import { Logger } from '@nestjs/common';
import { ChatPromptDto } from '../dtos/chat-prompt.dto';
import { geminiUploadFiles } from '../helpers/gemini-upload-file';
import { streamInteractionText } from '../helpers/stream-interaction-text';
import {
  StoredMessage,
  buildConversationInput,
} from '../types/interaction-input';

interface Options {
  model?: string;
  systemInstruction?: string;
  history: StoredMessage[];
}

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_SYSTEM_INSTRUCTION = `
  Eres Plantini, el asistente virtual de VoluntariadoUPB, la plataforma de
  voluntariado de la Universidad Privada Boliviana (UPB).

  Tu rol es ayudar a los usuarios con:
  - Información sobre oportunidades de voluntariado disponibles en la plataforma
  - Proceso de postulación: cómo aplicar, estados (pendiente, aceptado, rechazado)
  - Gestión del perfil del voluntario y logros (metas)
  - Roles y permisos dentro de la aplicación (admin, voluntario)
  - Preguntas generales sobre el programa de voluntariado de la UPB

  Reglas:
  - Responde únicamente en español.
  - Usa formato markdown. Para negritas usa **.
  - Si la consulta no está relacionada con VoluntariadoUPB o el voluntariado
    universitario, indica amablemente que solo puedes ayudar con temas de la app.
  - No inventes información sobre oportunidades específicas si no la conoces.
  - Sé conciso y útil.
`;

/**
 * Only the most recent turns are replayed to the model. Keeps the token cost
 * of a long conversation bounded (history is stored in user/model pairs, so
 * an even number keeps the turns aligned).
 */
const MAX_HISTORY_MESSAGES = 40;

const logger = new Logger('ChatPromptStreamUseCase');

export const chatPromptStreamUseCase = async (
  ai: GoogleGenAI,
  chatPromptDto: ChatPromptDto,
  options?: Options,
): Promise<AsyncGenerator<string>> => {
  const { prompt, files = [] } = chatPromptDto;
  const uploadedFiles = await geminiUploadFiles(ai, files);

  const {
    model = DEFAULT_MODEL,
    history = [],
    systemInstruction = DEFAULT_SYSTEM_INSTRUCTION,
  } = options ?? {};

  // Defensive: drop any history entry with no usable text. A prior failed
  // stream may have persisted `{ role: 'model', parts: [{ text: '' }] }` —
  // sending empty turns makes the model reject the request.
  const sanitizedHistory = history
    .filter((turn) =>
      turn.parts?.some(
        (part) => typeof part.text === 'string' && part.text.trim().length > 0,
      ),
    )
    .slice(-MAX_HISTORY_MESSAGES);

  if (sanitizedHistory.length !== history.length) {
    logger.warn(
      `Dropped ${history.length - sanitizedHistory.length} empty/old turn(s) ` +
        `from chat history before sending to Gemini`,
    );
  }

  const input = buildConversationInput(sanitizedHistory, prompt, uploadedFiles);

  logger.log(
    `Gemini interaction: model=${model} historyTurns=${sanitizedHistory.length} ` +
      `uploadedFiles=${uploadedFiles.length} promptLen=${prompt.length}`,
  );

  try {
    const stream = await ai.interactions.create({
      model,
      system_instruction: systemInstruction,
      input,
      stream: true,
    });

    return streamInteractionText(stream);
  } catch (error) {
    // Dump the SDK error verbatim — `cause`, `response`, JSON body, anything
    // the SDK attached — so we can tell which field the API rejected instead
    // of seeing only a generic error string upstream.
    const err = error as {
      message?: string;
      cause?: unknown;
      response?: { status?: number; data?: unknown };
      status?: number;
    };
    logger.error(
      `Gemini interactions.create failed for model=${model}\n` +
        `  message: ${err.message}\n` +
        `  status: ${err.status ?? err.response?.status ?? 'n/a'}\n` +
        `  cause: ${err.cause ? JSON.stringify(err.cause, null, 2) : 'n/a'}\n` +
        `  response.data: ${err.response?.data ? JSON.stringify(err.response.data, null, 2) : 'n/a'}`,
      error instanceof Error ? error.stack : String(error),
    );
    throw error;
  }
};
