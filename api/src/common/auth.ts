import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from '../database/entities';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { MAX_SKEW_SECONDS, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from './signing';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

type AuthedRequest = {
  headers: Record<string, string | undefined>;
  user?: AuthUser;
};

const ROLES_KEY = 'roles';

/** Verifies the bearer token, then loads the user so a deactivated account stops working at once. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required');

    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(header.slice(7), {
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid or expired token');
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || !required.includes(user.role)) throw new ForbiddenException('You do not have access to this');
    return true;
  }
}

/** `@Auth()` for any signed-in user, `@Auth('admin')` for specific roles. */
export const Auth = (...roles: UserRole[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(JwtAuthGuard, RolesGuard));

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException('Authentication required');
  return user;
});

/** Guards /internal routes: only a caller holding the shared secret can pass. */
@Injectable()
export class InternalSignatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      method: string;
      originalUrl: string;
      rawBody?: Buffer;
    }>();
    const signature = req.headers[SIGNATURE_HEADER];
    const timestamp = req.headers[TIMESTAMP_HEADER];
    if (!signature || !timestamp || !/^[0-9a-f]+$/i.test(signature)) {
      throw new UnauthorizedException('Missing or malformed signature');
    }
    const body = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!verify(this.config.internalHmacSecret, signature, timestamp, req.method, req.originalUrl, body)) {
      throw new UnauthorizedException(`Invalid signature (clock skew limit ${MAX_SKEW_SECONDS}s)`);
    }
    return true;
  }
}

export const Internal = () => UseGuards(InternalSignatureGuard);

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
