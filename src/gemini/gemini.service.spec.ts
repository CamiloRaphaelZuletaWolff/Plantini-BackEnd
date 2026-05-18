import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GeminiService } from './gemini.service';
import { ChatHistoryRepository } from './repositories/chat-history.repository';
import { SupabaseService } from '../supabase/supabase.service';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const buildService = (repoOverrides: Partial<ChatHistoryRepository>) => {
  const repo = {
    findByChatId: jest.fn().mockResolvedValue([]),
    checkOwnership: jest.fn().mockResolvedValue('owned'),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    ...repoOverrides,
  } as unknown as ChatHistoryRepository;

  const config = {
    getOrThrow: jest.fn().mockReturnValue('fake-api-key'),
  } as unknown as ConfigService;

  const supabase = { client: {} } as unknown as SupabaseService;

  return { service: new GeminiService(config, repo, supabase), repo };
};

describe('GeminiService — chat authorization', () => {
  describe('getChatHistory', () => {
    it('forwards (chatId, userId) to the repository', async () => {
      const { service, repo } = buildService({
        findByChatId: jest.fn().mockResolvedValue([
          { role: 'user', parts: [{ text: 'hola' }] },
        ]),
      });

      const result = await service.getChatHistory(CHAT_ID, USER_A);

      expect(repo.findByChatId).toHaveBeenCalledWith(CHAT_ID, USER_A);
      expect(result).toEqual([{ role: 'user', parts: [{ text: 'hola' }] }]);
    });
  });

  describe('saveMessages', () => {
    it('throws ForbiddenException when the chatId belongs to another user', async () => {
      const { service, repo } = buildService({
        checkOwnership: jest.fn().mockResolvedValue('forbidden'),
      });

      await expect(
        service.saveMessages(CHAT_ID, USER_A, [
          { role: 'user', parts: [{ text: 'leak attempt' }] },
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repo.checkOwnership).toHaveBeenCalledWith(CHAT_ID, USER_A);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('appends and persists when the chat is owned by the caller', async () => {
      const existing = [{ role: 'user', parts: [{ text: 'old' }] }];
      const { service, repo } = buildService({
        checkOwnership: jest.fn().mockResolvedValue('owned'),
        findByChatId: jest.fn().mockResolvedValue(existing),
      });

      const newMsg = { role: 'model', parts: [{ text: 'new' }] };
      await service.saveMessages(CHAT_ID, USER_A, [newMsg]);

      expect(repo.save).toHaveBeenCalledWith(CHAT_ID, USER_A, [
        ...existing,
        newMsg,
      ]);
    });

    it('allows the first write of a "new" chat (claims ownership)', async () => {
      const { service, repo } = buildService({
        checkOwnership: jest.fn().mockResolvedValue('new'),
        findByChatId: jest.fn().mockResolvedValue([]),
      });

      const msg = { role: 'user', parts: [{ text: 'first' }] };
      await service.saveMessages(CHAT_ID, USER_A, [msg]);

      expect(repo.save).toHaveBeenCalledWith(CHAT_ID, USER_A, [msg]);
    });
  });

  describe('clearChatHistory', () => {
    it('refuses to clear a chat belonging to another user', async () => {
      const { service, repo } = buildService({
        checkOwnership: jest.fn().mockResolvedValue('forbidden'),
      });

      await expect(
        service.clearChatHistory(CHAT_ID, USER_A),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repo.clear).not.toHaveBeenCalled();
    });

    it('clears when the caller owns the chat', async () => {
      const { service, repo } = buildService({
        checkOwnership: jest.fn().mockResolvedValue('owned'),
      });

      await service.clearChatHistory(CHAT_ID, USER_A);

      expect(repo.clear).toHaveBeenCalledWith(CHAT_ID, USER_A);
    });
  });

  describe('chatStream', () => {
    it('blocks streaming when the user does not own the chatId', async () => {
      const { service, repo } = buildService({
        checkOwnership: jest.fn().mockResolvedValue('forbidden'),
      });

      await expect(
        service.chatStream(
          { prompt: 'leak', chatId: CHAT_ID, files: [] },
          USER_B,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repo.findByChatId).not.toHaveBeenCalled();
    });
  });
});
