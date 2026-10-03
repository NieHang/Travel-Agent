import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@autix/contracts';
import { AppException } from '../common/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import type { User as UserRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type { UserRow };

type Locale = 'zh' | 'en';

export function toUserContract(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    locale: row.locale as Locale,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: {
    email: string;
    passwordHash: string;
    nickname: string;
    locale: Locale;
  }): Promise<UserRow> {
    try {
      return await this.prisma.user.create({ data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('EMAIL_TAKEN', 409);
      }
      throw error;
    }
  }

  findByEmail(email: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  update(id: string, patch: { nickname?: string; locale?: Locale }): Promise<UserRow> {
    return this.prisma.user.update({ where: { id }, data: patch });
  }
}
