import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { UpdateMeRequestSchema, type UpdateMeRequest, type User } from '@autix/contracts';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { AppException } from '../common/app.exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Prisma } from '../generated/prisma/client.js';
import { UsersService, toUserContract } from './users.service.js';

@Controller('api/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() current: AuthUser): Promise<User> {
    const row = await this.users.findById(current.userId);
    // token 校验不查库：签发后用户被删除，在这里才会发现。
    if (!row) throw new AppException('TOKEN_INVALID', 401);
    return toUserContract(row);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() current: AuthUser,
    @Body(new ZodValidationPipe(UpdateMeRequestSchema)) body: UpdateMeRequest,
  ): Promise<User> {
    try {
      return toUserContract(await this.users.update(current.userId, body));
    } catch (error) {
      // 用户已被删除：与 GET 一致。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new AppException('TOKEN_INVALID', 401);
      }
      throw error;
    }
  }
}
