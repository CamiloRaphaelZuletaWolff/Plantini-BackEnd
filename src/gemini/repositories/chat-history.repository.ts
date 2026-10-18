import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { StoredMessage } from '../types/interaction-input';

interface ChatHistoryRow {
  chat_id: string;
  user_id: string;
  messages: StoredMessage[];
  updated_at: string;
}

export type Ownership = 'owned' | 'new' | 'forbidden';

/**
 * Persists chat histories in Supabase PostgreSQL.
 *
 * NOTE on RLS: the backend uses the service_role key, which bypasses Row
 * Level Security. Ownership therefore MUST be enforced in code on every read,
 * write, and delete — the RLS policies on `chat_histories` only protect
 * direct client access, not the service-role pathway used here.
 */
@Injectable()
export class ChatHistoryRepository {
  private readonly logger = new Logger(ChatHistoryRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Returns the history for (chatId, userId). Returns [] if the chat does
   * not exist OR is owned by a different user — both cases are
   * indistinguishable to the caller, which prevents existence-leak.
   */
  async findByChatId(chatId: string, userId: string): Promise<StoredMessage[]> {
    const { data, error } = (await this.supabaseService.client
      .from('chat_histories')
      .select('messages')
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .maybeSingle()) as {
      data: Pick<ChatHistoryRow, 'messages'> | null;
      error: Error | null;
    };

    if (error) {
      this.logger.error(
        `Error loading chat history for ${chatId}`,
        error.message,
      );
      throw error;
    }

    return data?.messages ?? [];
  }

  /**
   * Determines whether `userId` may read/write `chatId`:
   *   - 'owned'     → row exists and belongs to userId
   *   - 'new'       → row does not exist; userId may claim it
   *   - 'forbidden' → row exists but belongs to a different user
   *
   * Callers MUST check this before any save/delete that could touch a row
   * by chat_id (which is the table's primary key, so an upsert with a
   * stolen chat_id would otherwise hijack another user's history).
   */
  async checkOwnership(chatId: string, userId: string): Promise<Ownership> {
    const { data, error } = (await this.supabaseService.client
      .from('chat_histories')
      .select('user_id')
      .eq('chat_id', chatId)
      .maybeSingle()) as {
      data: Pick<ChatHistoryRow, 'user_id'> | null;
      error: Error | null;
    };

    if (error) {
      this.logger.error(
        `Error checking ownership for ${chatId}`,
        error.message,
      );
      throw error;
    }

    if (!data) return 'new';
    return data.user_id === userId ? 'owned' : 'forbidden';
  }

  async save(
    chatId: string,
    userId: string,
    messages: StoredMessage[],
  ): Promise<void> {
    const row: ChatHistoryRow = {
      chat_id: chatId,
      user_id: userId,
      messages,
      updated_at: new Date().toISOString(),
    };

    const { error } = await (this.supabaseService.client
      .from('chat_histories')
      .upsert(row as never, { onConflict: 'chat_id' }) as unknown as Promise<{
      error: Error | null;
    }>);

    if (error) {
      this.logger.error(
        `Error saving chat history for ${chatId}`,
        error.message,
      );
      throw error;
    }
  }

  async clear(chatId: string, userId: string): Promise<void> {
    const { error } = await (this.supabaseService.client
      .from('chat_histories')
      .delete()
      .eq('chat_id', chatId)
      .eq('user_id', userId) as unknown as Promise<{ error: Error | null }>);

    if (error) {
      this.logger.error(
        `Error clearing chat history for ${chatId}`,
        error.message,
      );
      throw error;
    }
  }
}
