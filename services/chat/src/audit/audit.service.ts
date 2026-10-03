import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditEvent } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

const USER_AGENT_MAX = 255;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Writes an audit record. Never throws: auditing must not break the request. */
  async record(
    event: AuditEvent,
    input: ClientContext & { userId?: string; metadata?: object },
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          event,
          userId: input.userId ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log (${event})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
