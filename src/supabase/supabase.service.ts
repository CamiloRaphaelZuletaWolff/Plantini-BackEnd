import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

/**
 * Provides a single server-side Supabase client configured with the
 * service_role key so it bypasses Row Level Security (RLS).
 *
 * ⚠️  NEVER expose this client or its key to the frontend.
 */
@Injectable()
export class SupabaseService {
  // Type inferred from createClient return — no manual annotation needed
  readonly client: ReturnType<typeof createClient>;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const key = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    this.client = createClient(url, key, {
      auth: {
        // Disable auto-refresh and session persistence for a stateless server
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
}
