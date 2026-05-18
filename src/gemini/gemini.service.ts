import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Content, GoogleGenAI } from '@google/genai';

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

  async chatStream(chatPromptDto: ChatPromptDto) {
    const chatHistory = await this.getChatHistory(chatPromptDto.chatId);
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

  async getChatHistory(chatId: string): Promise<Content[]> {
    this.logger.debug(`Obteniendo historial para el chat ${chatId}`);
    try {
      return await this.chatHistoryRepository.findByChatId(chatId);
    } catch (error) {
      this.logger.error(
        `No se pudo cargar el historial del chat ${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }

  /**
   * Appends one or more messages to the chat history atomically
   * (single read + single write to Supabase).
   */
  async saveMessages(chatId: string, newMessages: Content[]): Promise<void> {
    this.logger.debug(
      `Guardando ${newMessages.length} mensaje(s) para el chat ${chatId}`,
    );
    try {
      const history = await this.chatHistoryRepository.findByChatId(chatId);
      await this.chatHistoryRepository.save(chatId, [
        ...history,
        ...newMessages,
      ]);
    } catch (error) {
      this.logger.error(
        `No se pudo persistir el historial del chat ${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async clearChatHistory(chatId: string): Promise<void> {
    this.logger.log(`Limpiando historial para el chat ${chatId}`);
    try {
      await this.chatHistoryRepository.clear(chatId);
    } catch (error) {
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
}
