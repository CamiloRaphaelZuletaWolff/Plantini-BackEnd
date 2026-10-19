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
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import { Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';

// Ensures Express.Multer namespace augmentation is loaded by TypeScript
import 'multer';

import { GeminiService } from './gemini.service';
import { BasicPromptDto } from './dtos/basic-prompt.dto';
import { ChatPromptDto } from './dtos/chat-prompt.dto';
import { ImageGenerationDto } from './dtos/image-generation.dto';
import { AuthGuard } from '../auth/auth.guard';
import { MAX_UPLOAD_FILES, uploadOptions } from './helpers/upload-limits';

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
    stream: AsyncGenerator<string>,
  ) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(HttpStatus.OK);

    let resultText = '';
    let chunkCount = 0;
    try {
      for await (const piece of stream) {
        if (!piece) continue;
        chunkCount += 1;
        resultText += piece;
        res.write(piece);
      }

      this.logger.log(
        `Stream completed: ${chunkCount} chunks, ${resultText.length} chars`,
      );
      res.end();
      return resultText;
    } catch (error) {
      this.logger.error(
        `Stream aborted after ${chunkCount} chunks / ${resultText.length} chars`,
        error instanceof Error ? error.stack : String(error),
      );
      this.handleStreamError(
        res,
        error,
        'No se pudo completar la respuesta en streaming',
      );
      return resultText;
    }
  }

  // The frontend sends multipart/form-data (prompt + optional files[]) and
  // reads the reply with `res.json()`, so parse multipart here and wrap the
  // text in a JSON object (same `{ text }` shape as the Express backend).
  @Post('basic-prompt')
  @UseInterceptors(FilesInterceptor('files', MAX_UPLOAD_FILES, uploadOptions))
  async basicPrompt(
    @Body() basicPromptDto: BasicPromptDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    basicPromptDto.files = files;

    try {
      const text = await this.geminiService.basicPrompt(basicPromptDto);
      return { text };
    } catch (error) {
      this.handleError(error, 'No se pudo completar el prompt básico');
    }
  }

  @Post('basic-prompt-stream')
  @UseInterceptors(FilesInterceptor('files', MAX_UPLOAD_FILES, uploadOptions))
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
  @UseInterceptors(FilesInterceptor('files', MAX_UPLOAD_FILES, uploadOptions))
  async chatStream(
    @Body() chatPromptDto: ChatPromptDto,
    @Res() res: Response,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Req() request: AuthenticatedRequest,
  ) {
    chatPromptDto.files = files;
    const userId = request.user.id;

    this.logger.log(
      `chat-stream user=${userId} chatId=${chatPromptDto.chatId} ` +
        `promptLen=${chatPromptDto.prompt?.length ?? 0} files=${files?.length ?? 0}`,
    );

    try {
      const stream = await this.geminiService.chatStream(chatPromptDto, userId);
      const data = await this.outputStreamResponse(res, stream);

      // Only persist when the model actually produced text. Saving an empty
      // model turn corrupts the next request — Gemini rejects history that
      // contains empty parts with "exception parsing response".
      if (data.trim().length > 0) {
        await this.geminiService.saveMessages(chatPromptDto.chatId, userId, [
          { role: 'user', parts: [{ text: chatPromptDto.prompt }] },
          { role: 'model', parts: [{ text: data }] },
        ]);
      } else {
        this.logger.warn(
          `Skipped save for chat ${chatPromptDto.chatId}: model returned 0 chars`,
        );
      }
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
    @Param('chatId', new ParseUUIDPipe()) chatId: string,
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
    @Param('chatId', new ParseUUIDPipe()) chatId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      await this.geminiService.clearChatHistory(chatId, request.user.id);
      return { chatId, cleared: true };
    } catch (error) {
      this.handleError(error, 'No se pudo limpiar el historial del chat');
    }
  }

  // Much tighter limit than the global 20/min: each call generates an image.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('image-generation')
  @UseInterceptors(FilesInterceptor('files', MAX_UPLOAD_FILES, uploadOptions))
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
      // Only our own HttpExceptions carry client-safe messages. Anything
      // else (Gemini SDK, Supabase, network) may include internal details,
      // so the client gets the generic message and the details stay in logs.
      if (error instanceof HttpException) {
        res.status(error.getStatus()).json({
          statusCode: error.getStatus(),
          message: error.message,
        });
        return;
      }
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message,
      });
      return;
    }

    res.write('\n[Error] ' + message);
    res.end();
  }
}
