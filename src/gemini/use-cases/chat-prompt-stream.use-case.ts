import { Content, createPartFromUri, GoogleGenAI } from '@google/genai';
import { ChatPromptDto } from '../dtos/chat-prompt.dto';
import { geminiUploadFiles } from '../helpers/gemini-upload-file';

interface Options {
  model?: string;
  systemInstruction?: string;
  history: Content[];
}

export const chatPromptStreamUseCase = async (
  ai: GoogleGenAI,
  chatPromptDto: ChatPromptDto,
  options?: Options,
) => {
  const { prompt, files = [] } = chatPromptDto;
  const uploadedFiles = await geminiUploadFiles(ai, files);

  const {
    model = 'gemini-2.0-flash',
    history = [],
    systemInstruction = `
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
    `,
  } = options ?? {};

  const chat = ai.chats.create({
    model: model,
    config: {
      systemInstruction: systemInstruction,
    },
    history: history,
  });

  return chat.sendMessageStream({
    message: [
      prompt,
      ...uploadedFiles.map((file) =>
        createPartFromUri(file.uri ?? '', file.mimeType ?? ''),
      ),
    ],
  });
};
