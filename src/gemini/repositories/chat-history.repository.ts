import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { StoredMessage } from '../types/interaction-input';

interface ChatHistoryRow {
  chat_id: string;
  user_id: string;
  messages: StoredMessage[];
  updated_at: string;
}

/** Postgres error code for a primary-key / unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

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

  /**
   * Persists `messages` for (chatId, userId) WITHOUT ever touching a row
   * owned by someone else:
   *   1. UPDATE ... WHERE chat_id = ? AND user_id = ?  (the caller's own row)
   *   2. if nothing was updated, INSERT a new row (claims the chat). The
   *      chat_id primary key makes a concurrent/stolen claim fail with
   *      23505 instead of overwriting the other user's history.
   *
   * A plain `upsert(onConflict: chat_id)` would rewrite `user_id` and hand
   * the history to whoever guessed the chat_id, so it is intentionally not
   * used here.
   */
  async save(
    chatId: string,
    userId: string,
    messages: StoredMessage[],
  ): Promise<void> {
    const updatedAt = new Date().toISOString();

    const { data: updated, error: updateError } =
      (await this.supabaseService.client
        .from('chat_histories')
        .update({ messages, updated_at: updatedAt } as never)
        .eq('chat_id', chatId)
        .eq('user_id', userId)
        .select('chat_id')) as {
        data: Pick<ChatHistoryRow, 'chat_id'>[] | null;
        error: Error | null;
      };

    if (updateError) {
      this.logger.error(
        `Error saving chat history for ${chatId}`,
        updateError.message,
      );
      throw updateError;
    }

    if (updated && updated.length > 0) return;

    const row: ChatHistoryRow = {
      chat_id: chatId,
      user_id: userId,
      messages,
      updated_at: updatedAt,
    };

    const { error: insertError } = (await this.supabaseService.client
      .from('chat_histories')
      .insert(row as never)) as {
      error: (Error & { code?: string }) | null;
    };

    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION) {
        // The chat_id exists but is not ours (or was claimed concurrently).
        throw new ForbiddenException('No tienes acceso a este chat');
      }
      this.logger.error(
        `Error saving chat history for ${chatId}`,
        insertError.message,
      );
      throw insertError;
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
