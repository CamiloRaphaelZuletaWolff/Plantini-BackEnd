import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';

// Ensures Express.Multer namespace augmentation is loaded by TypeScript
import 'multer';

import { GeminiService } from './gemini.service';
import { BasicPromptDto } from './dtos/basic-prompt.dto';
import { ChatPromptDto } from './dtos/chat-prompt.dto';
import { GenerateContentResponse } from '@google/genai';
import { ImageGenerationDto } from './dtos/image-generation.dto';
import { AuthGuard } from '../auth/auth.guard';

/**
 * Request with the user attached by AuthGuard.
 * @see AuthGuard.canActivate which sets `request.user`.
 */
type AuthenticatedRequest = Request & { user: User };

@UseGuards(AuthGuard)
@Controller('gemini')
export class GeminiController {
  private readonly logger = new Logger(GeminiController.name);

  constructor(private readonly geminiService: GeminiService) {}

  private async outputStreamResponse(
    res: Response,
    stream: AsyncGenerator<GenerateContentResponse, any, any>,
  ) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(HttpStatus.OK);

    let resultText = '';
    try {
      for await (const chunk of stream) {
        const piece = chunk.text;
        resultText += piece;
        res.write(piece);
      }

      res.end();
      return resultText;
    } catch (error) {
      this.handleStreamError(
        res,
        error,
        'No se pudo completar la respuesta en streaming',
      );
      return resultText;
    }
  }

  @Post('basic-prompt')
  async basicPrompt(@Body() basicPromptDto: BasicPromptDto) {
    try {
      return await this.geminiService.basicPrompt(basicPromptDto);
    } catch (error) {
      this.handleError(error, 'No se pudo completar el prompt básico');
    }
  }

  @Post('basic-prompt-stream')
  @UseInterceptors(FilesInterceptor('files'))
  async basicPromptStream(
    @Body() basicPromptDto: BasicPromptDto,
    @Res() res: Response,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    basicPromptDto.files = files;

    try {
      const stream = await this.geminiService.basicPromptStream(basicPromptDto);
      await this.outputStreamResponse(res, stream);
    } catch (error) {
      this.handleStreamError(
        res,
        error,
        'No se pudo generar la respuesta en streaming',
      );
    }
  }

  @Post('chat-stream')
  @UseInterceptors(FilesInterceptor('files'))
  async chatStream(
    @Body() chatPromptDto: ChatPromptDto,
    @Res() res: Response,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Req() request: AuthenticatedRequest,
  ) {
    chatPromptDto.files = files;
    const userId = request.user.id;

    try {
      const stream = await this.geminiService.chatStream(
        chatPromptDto,
        userId,
      );
      const data = await this.outputStreamResponse(res, stream);

      // Save both messages in a single Supabase write — scoped to the
      // authenticated user so a guessed chatId cannot hijack another user's
      // history.
      await this.geminiService.saveMessages(chatPromptDto.chatId, userId, [
        { role: 'user', parts: [{ text: chatPromptDto.prompt }] },
        { role: 'model', parts: [{ text: data }] },
      ]);
    } catch (error) {
      this.handleStreamError(
        res,
        error,
        'No se pudo completar el chat en streaming',
      );
    }
  }

  @Get('chat-history/:chatId')
  async getChatHistory(
    @Param('chatId') chatId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    // findByChatId filters by (chat_id, user_id) — returns [] for chats not
    // owned by the caller without revealing whether they exist.
    const history = await this.geminiService.getChatHistory(
      chatId,
      request.user.id,
    );

    return history.map((message) => ({
      role: message.role,
      parts: message.parts?.map((part) => part.text).join(''),
    }));
  }

  @Delete('chat-history/:chatId')
  async clearChatHistory(
    @Param('chatId') chatId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      await this.geminiService.clearChatHistory(chatId, request.user.id);
      return { chatId, cleared: true };
    } catch (error) {
      this.handleError(error, 'No se pudo limpiar el historial del chat');
    }
  }

  @Post('image-generation')
  @UseInterceptors(FilesInterceptor('files'))
  async imageGeneration(
    @Body() imageGenerationDto: ImageGenerationDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    imageGenerationDto.files = files;

    try {
      const { imageUrl, text } =
        await this.geminiService.imageGeneration(imageGenerationDto);
      return { imageUrl, text };
    } catch (error) {
      this.handleError(error, 'No se pudo generar la imagen');
    }
  }

  private handleError(error: unknown, message: string): never {
    this.logger.error(
      message,
      error instanceof Error ? error.stack : String(error),
    );

    if (error instanceof HttpException) {
      throw error;
    }

    throw new InternalServerErrorException(message);
  }

  private handleStreamError(res: Response, error: unknown, message: string) {
    this.logger.error(
      message,
      error instanceof Error ? error.stack : String(error),
    );

    if (res.writableEnded) {
      return;
    }

    if (!res.headersSent) {
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      res.status(status).json({
        message,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    res.write('\n[Error] ' + message);
    res.end();
  }
}
