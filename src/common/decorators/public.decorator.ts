import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route (or a whole controller) as open: JwtAuthGuard lets it through without a token
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
