import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth } from '@nestjs/swagger';

export enum Role {
  CUSTOMER = 'customer',
  ADMIN = 'admin',
}

export interface AuthUser {
  id: string;
  role: Role;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Missing token');

    try {
      const { sub, role } = this.jwt.verify(token);
      request.user = { id: sub, role };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles.length && !roles.includes(request.user.role)) {
      throw new ForbiddenException('You are not allowed to do this');
    }
    return true;
  }
}

/** `@Auth()` = any logged-in user, `@Auth(Role.ADMIN)` = admins only. */
export const Auth = (...roles: Role[]) =>
  applyDecorators(
    SetMetadata('roles', roles),
    UseGuards(AuthGuard),
    ApiBearerAuth(),
  );

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest().user,
);
