import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

import { StoredMessage } from './types/interaction-input';
import { BasicPromptDto } from './dtos/basic-prompt.dto';
import { basicPromptUseCase } from './use-cases/basic-prompt.use-case';
import { basicPromptStreamUseCase } from './use-cases/basic-prompt-stream.use-case';
import { ChatPromptDto } from './dtos/chat-prompt.dto';
import { chatPromptStreamUseCase } from './use-cases/chat-prompt-stream.use-case';
import { ImageGenerationDto } from './dtos/image-generation.dto';
import { imageGenerationUseCase } from './use-cases/image-generation.use-case';
import { ChatHistoryRepository } from './repositories/chat-history.repository';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class GeminiService {
  private readonly ai: GoogleGenAI;
  private readonly logger = new Logger(GeminiService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly chatHistoryRepository: ChatHistoryRepository,
    private readonly supabaseService: SupabaseService,
  ) {
    const apiKey = this.configService.getOrThrow<string>('GEMINI_API_KEY');
    this.ai = new GoogleGenAI({ apiKey });
  }

  async basicPrompt(basicPromptDto: BasicPromptDto) {
    try {
      return await basicPromptUseCase(this.ai, basicPromptDto);
    } catch (error) {
      this.logger.error(
        'Error al procesar el prompt básico',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async basicPromptStream(basicPromptDto: BasicPromptDto) {
    try {
      return await basicPromptStreamUseCase(this.ai, basicPromptDto);
    } catch (error) {
      this.logger.error(
        'Error al procesar el prompt básico en streaming',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async chatStream(chatPromptDto: ChatPromptDto, userId: string) {
    await this.assertChatAccess(chatPromptDto.chatId, userId);

    const chatHistory = await this.getChatHistory(chatPromptDto.chatId, userId);
    try {
      return await chatPromptStreamUseCase(this.ai, chatPromptDto, {
        history: chatHistory,
      });
    } catch (error) {
      this.logger.error(
        'Error al procesar el chat en streaming',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async getChatHistory(
    chatId: string,
    userId: string,
  ): Promise<StoredMessage[]> {
    this.logger.debug(
      `Obteniendo historial para el chat ${chatId} (user ${userId})`,
    );
    try {
      return await this.chatHistoryRepository.findByChatId(chatId, userId);
    } catch (error) {
      this.logger.error(
        `No se pudo cargar el historial del chat ${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }

  /**
   * Appends one or more messages to the chat history. Requires `userId` to
   * enforce ownership — refuses to write if the chatId already belongs to
   * another user (prevents hijack via guessed chat_id).
   */
  async saveMessages(
    chatId: string,
    userId: string,
    newMessages: StoredMessage[],
  ): Promise<void> {
    this.logger.debug(
      `Guardando ${newMessages.length} mensaje(s) para el chat ${chatId} (user ${userId})`,
    );
    try {
      await this.assertChatAccess(chatId, userId);
      const history = await this.chatHistoryRepository.findByChatId(
        chatId,
        userId,
      );
      await this.chatHistoryRepository.save(chatId, userId, [
        ...history,
        ...newMessages,
      ]);
    } catch (error) {
      // Re-throw authorization errors so the caller surfaces a 403.
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(
        `No se pudo persistir el historial del chat ${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async clearChatHistory(chatId: string, userId: string): Promise<void> {
    this.logger.log(
      `Limpiando historial para el chat ${chatId} (user ${userId})`,
    );
    try {
      await this.assertChatAccess(chatId, userId);
      await this.chatHistoryRepository.clear(chatId, userId);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(
        `No se pudo limpiar el historial del chat ${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async imageGeneration(imageGenerationDto: ImageGenerationDto) {
    try {
      return await imageGenerationUseCase(this.ai, imageGenerationDto, {
        supabase: this.supabaseService.client,
      });
    } catch (error) {
      this.logger.error(
        'Error al generar la imagen',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Throws ForbiddenException if `userId` does not own `chatId`. New chats
   * (no row yet) are allowed — the calling user claims them on first write.
   */
  private async assertChatAccess(
    chatId: string,
    userId: string,
  ): Promise<void> {
    const ownership = await this.chatHistoryRepository.checkOwnership(
      chatId,
      userId,
    );
    if (ownership === 'forbidden') {
      this.logger.warn(
        `Usuario ${userId} intentó acceder al chat ${chatId} sin permiso`,
      );
      throw new ForbiddenException('No tienes acceso a este chat');
    }
  }
}
