import { Injectable, Logger } from '@nestjs/common';
import { Content } from '@google/genai';
import { SupabaseService } from '../../supabase/supabase.service';

// Minimal row shape — avoids dependency on generated Supabase types while
// keeping type safety for what we actually read/write.
interface ChatHistoryRow {
  chat_id: string;
  messages: Content[];
  updated_at: string;
}

/**
 * Persists chat histories in Supabase PostgreSQL.
 *
 * Required table (run in Supabase SQL editor):
 *   See sql/schema.sql → chat_histories
 */
@Injectable()
export class ChatHistoryRepository {
  private readonly logger = new Logger(ChatHistoryRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async findByChatId(chatId: string): Promise<Content[]> {
    const { data, error } = (await this.supabaseService.client
      .from('chat_histories')
      .select('messages')
      .eq('chat_id', chatId)
      .maybeSingle()) as { data: Pick<ChatHistoryRow, 'messages'> | null; error: Error | null };

    if (error) {
      this.logger.error(`Error loading chat history for ${chatId}`, error.message);
      throw error;
    }

    return data?.messages ?? [];
  }

  async save(chatId: string, messages: Content[]): Promise<void> {
    const row: ChatHistoryRow = {
      chat_id: chatId,
      messages,
      updated_at: new Date().toISOString(),
    };

    const { error } = await (this.supabaseService.client
      .from('chat_histories')
      .upsert(row as never, { onConflict: 'chat_id' }) as unknown as Promise<{
      error: Error | null;
    }>);

    if (error) {
      this.logger.error(`Error saving chat history for ${chatId}`, error.message);
      throw error;
    }
  }

  async clear(chatId: string): Promise<void> {
    const { error } = await (this.supabaseService.client
      .from('chat_histories')
      .delete()
      .eq('chat_id', chatId) as unknown as Promise<{ error: Error | null }>);

    if (error) {
      this.logger.error(`Error clearing chat history for ${chatId}`, error.message);
      throw error;
    }
  }
}
