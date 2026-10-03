import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';

@Module({
  imports: [UsersModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccessTokenService, JwtAuthGuard],
  exports: [AuthService, AccessTokenService, JwtAuthGuard],
})
export class AuthModule {}
