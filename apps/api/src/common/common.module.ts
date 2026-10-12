import { Global, Module } from '@nestjs/common';
import { AccessService } from './auth/access.service';
import { SessionService } from './auth/session.service';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { StorageService } from '../modules/storage/storage.service';
import { NotificationService } from '../modules/notifications/notification.service';

@Global()
@Module({
  providers: [PrismaService, SessionService, AuditService, AccessService, StorageService, NotificationService],
  exports: [PrismaService, SessionService, AuditService, AccessService, StorageService, NotificationService],
})
export class CommonModule {}
