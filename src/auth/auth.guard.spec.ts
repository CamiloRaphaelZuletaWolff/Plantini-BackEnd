import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { SupabaseService } from '../supabase/supabase.service';

type GetUserResult = Awaited<
  ReturnType<SupabaseService['client']['auth']['getUser']>
>;

const makeContext = (authHeader?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  }) as unknown as ExecutionContext;

const makeSupabase = (getUser: jest.Mock): SupabaseService =>
  ({
    client: { auth: { getUser } },
  }) as unknown as SupabaseService;

describe('AuthGuard', () => {
  it('rejects requests without an Authorization header', async () => {
    const getUser = jest.fn();
    const guard = new AuthGuard(makeSupabase(getUser));

    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects headers that do not start with "Bearer "', async () => {
    const getUser = jest.fn();
    const guard = new AuthGuard(makeSupabase(getUser));

    await expect(
      guard.canActivate(makeContext('Basic abc123')),
    ).rejects.toThrow(UnauthorizedException);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects when Supabase returns an error or no user', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired' },
    } as unknown as GetUserResult);
    const guard = new AuthGuard(makeSupabase(getUser));

    await expect(
      guard.canActivate(makeContext('Bearer bad-token')),
    ).rejects.toThrow(UnauthorizedException);
    expect(getUser).toHaveBeenCalledWith('bad-token');
  });

  it('attaches the verified user to the request on success', async () => {
    const fakeUser = { id: 'user-uuid', email: 'a@b.co' };
    const getUser = jest.fn().mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    } as unknown as GetUserResult);

    const request: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: 'Bearer good-token' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const guard = new AuthGuard(makeSupabase(getUser));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getUser).toHaveBeenCalledWith('good-token');
    expect(request.user).toBe(fakeUser);
  });
});
