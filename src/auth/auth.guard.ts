import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Verifies the Supabase JWT Bearer token on every request.
 *
 * Usage: add @UseGuards(AuthGuard) on the controller or route handler.
 * The authenticated user is attached to `request.user` after verification.
 *
 * Frontend must send:
 *   Authorization: Bearer <supabase_access_token>
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autenticación requerido');
    }

    const token = authHeader.slice(7);

    const {
      data: { user },
      error,
    } = await this.supabaseService.client.auth.getUser(token);

    if (error || !user) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // Attach the verified user to the request for downstream use
    (request as Request & { user: typeof user }).user = user;

    return true;
  }
}
