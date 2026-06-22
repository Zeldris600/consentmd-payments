import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  userId: string;
  email: string;
  role: string;
  laravelId?: string;
  organizationId?: string;
  tenant?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

export const BearerToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    const header = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice(7).trim() || undefined;
  },
);
