import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthContext } from './auth/auth.types';
import { PrismaService, Tx } from './prisma.service';

export interface AuditInput {
  actor?: AuthContext | null;
  action: string;
  entityType: string;
  entityId: string;
  merchantId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Append-only audit trail for sensitive actions. Write inside the business transaction. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditEvent.create({
      data: {
        actorUserId: input.actor?.user.id ?? null,
        actorRoles: input.actor?.user.staffRoles ?? [],
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        merchantId: input.merchantId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ip: input.ip,
      },
    });
  }
}
