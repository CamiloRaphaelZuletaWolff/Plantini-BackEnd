import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GeminiController } from './gemini.controller';
import { ChatHistoryRepository } from './repositories/chat-history.repository';
import { AuthGuard } from '../auth/auth.guard';

@Module({
  controllers: [GeminiController],
  providers: [GeminiService, ChatHistoryRepository, AuthGuard],
})
export class GeminiModule {}
