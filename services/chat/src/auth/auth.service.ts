import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LoginRequest, RegisterRequest, User } from '@autix/contracts';
import { AuditService, type ClientContext } from '../audit/audit.service.js';
import { AppException } from '../common/app.exception.js';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService, toUserContract, type UserRow } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { PasswordService } from './password.service.js';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.js';

/** 被轮换掉的 token 在这段时间内再次出现，视为多标签页并发而不是盗用。 */
export const REUSE_GRACE_MS = 10_000;
/** 登录成功时，删除过期超过这么多天的 refresh token 记录。 */
export const EXPIRED_RETENTION_DAYS = 7;

const DAY_MS = 86_400_000;

export interface AuthSession {
  accessToken: string;
  user: User;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export class RefreshException extends AppException {
  readonly clearCookie: boolean;

  constructor(code: 'REFRESH_INVALID' | 'REFRESH_REUSED', clearCookie: boolean) {
    super(code, 401);
    this.clearCookie = clearCookie;
  }
}

type Db = PrismaService | Prisma.TransactionClient;

interface IssuedRefreshToken {
  id: string;
  raw: string;
  expiresAt: Date;
}

// 事务内不能靠抛异常表达"盗用"：那会把整链吊销一并回滚。事务只返回结论，提交后再抛。
type RefreshOutcome =
  | { kind: 'rotated'; user: UserRow; issued: IssuedRefreshToken }
  | { kind: 'invalid'; clearCookie: boolean }
  | { kind: 'reused'; userId: string; familyId: string };

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async register(input: RegisterRequest, ctx: ClientContext): Promise<AuthSession> {
    const user = await this.users.create({
      email: input.email,
      passwordHash: await this.passwords.hash(input.password),
      nickname: input.nickname,
      locale: input.locale,
    });
    const issued = await this.issueRefreshToken(this.prisma, user.id, randomUUID(), ctx, new Date());
    await this.audit.record('REGISTER', { ...ctx, userId: user.id });
    return this.toSession(user, issued);
  }

  async login(input: LoginRequest, ctx: ClientContext): Promise<AuthSession> {
    const user = await this.users.findByEmail(input.email);
    let ok = false;
    if (user) {
      ok = await this.passwords.verify(user.passwordHash, input.password);
    } else {
      // 邮箱不存在时也做一次 argon2 校验，使响应时间与密码错误一致。
      await this.passwords.verifyDummy(input.password);
    }
    if (!user || !ok) {
      await this.audit.record('LOGIN_FAILURE', {
        ...ctx,
        userId: user?.id,
        metadata: { email: input.email },
      });
      throw new AppException('INVALID_CREDENTIALS', 401);
    }

    const now = new Date();
    const issued = await this.issueRefreshToken(this.prisma, user.id, randomUUID(), ctx, now);
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId: user.id,
        expiresAt: { lt: new Date(now.getTime() - EXPIRED_RETENTION_DAYS * DAY_MS) },
      },
    });
    await this.audit.record('LOGIN_SUCCESS', { ...ctx, userId: user.id });
    return this.toSession(user, issued);
  }

  async refresh(raw: string | undefined, ctx: ClientContext): Promise<AuthSession> {
    if (!raw) throw new RefreshException('REFRESH_INVALID', true);
    const tokenHash = hashRefreshToken(raw);

    const outcome = await this.prisma.$transaction(async (tx): Promise<RefreshOutcome> => {
      const now = new Date();

      // 1. 查不到或已过期。
      const row = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!row || row.expiresAt.getTime() <= now.getTime()) {
        return { kind: 'invalid', clearCookie: true };
      }

      // 2. 条件吊销：并发的两个请求里只有一个能拿到 count === 1。
      const { count } = await tx.refreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count === 1) {
        const issued = await this.issueRefreshToken(tx, row.userId, row.familyId, ctx, now);
        await tx.refreshToken.update({ where: { id: row.id }, data: { replacedBy: issued.id } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
        return { kind: 'rotated', user, issued };
      }

      // 已被吊销。重新读取：条件更新可能等过另一个事务提交，之前读到的行已经过时。
      const current = await tx.refreshToken.findUnique({ where: { id: row.id } });
      if (!current?.revokedAt || !current.replacedBy) {
        // 随登出或整链吊销而失效（或已被删除）：不算盗用。
        return { kind: 'invalid', clearCookie: true };
      }

      // 3. 被轮换掉不久：多标签页并发，另一个请求已经写入新 Cookie。
      if (now.getTime() - current.revokedAt.getTime() <= REUSE_GRACE_MS) {
        return { kind: 'invalid', clearCookie: false };
      }

      // 4. 被轮换掉的 token 在宽限期之后再次出现：盗用，吊销整条链。
      await tx.refreshToken.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { kind: 'reused', userId: current.userId, familyId: current.familyId };
    });

    switch (outcome.kind) {
      case 'rotated':
        await this.audit.record('TOKEN_REFRESH', { ...ctx, userId: outcome.user.id });
        return this.toSession(outcome.user, outcome.issued);
      case 'reused':
        await this.audit.record('TOKEN_REUSE', {
          ...ctx,
          userId: outcome.userId,
          metadata: { familyId: outcome.familyId },
        });
        throw new RefreshException('REFRESH_REUSED', true);
      case 'invalid':
        throw new RefreshException('REFRESH_INVALID', outcome.clearCookie);
    }
  }

  async logout(raw: string | undefined, ctx: ClientContext): Promise<void> {
    if (!raw) return;
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(raw) },
    });
    if (!row) return;
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // 链已经整体吊销时是重复登出，不再记审计。
    if (count > 0) await this.audit.record('LOGOUT', { ...ctx, userId: row.userId });
  }

  private async issueRefreshToken(
    db: Db,
    userId: string,
    familyId: string,
    ctx: ClientContext,
    now: Date,
  ): Promise<IssuedRefreshToken> {
    const raw = generateRefreshToken();
    const expiresAt = new Date(now.getTime() + this.config.refreshTtlDays * DAY_MS);
    const { id } = await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashRefreshToken(raw),
        expiresAt,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      select: { id: true },
    });
    return { id, raw, expiresAt };
  }

  private async toSession(user: UserRow, issued: IssuedRefreshToken): Promise<AuthSession> {
    return {
      accessToken: await this.accessTokens.sign(user.id),
      user: toUserContract(user),
      refreshToken: issued.raw,
      refreshExpiresAt: issued.expiresAt,
    };
  }
}
