import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { Auth } from '../../common/auth/decorators';
import { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Auth() auth: AuthContext) {
    const items = await this.prisma.notification.findMany({
      where: { userId: auth.user.id, channel: NotificationChannel.IN_APP },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, template: true, subject: true, body: true, data: true, readAt: true, createdAt: true },
    });
    const unread = await this.prisma.notification.count({
      where: { userId: auth.user.id, channel: NotificationChannel.IN_APP, readAt: null },
    });
    return { items, unread };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId: auth.user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@Auth() auth: AuthContext) {
    await this.prisma.notification.updateMany({
      where: { userId: auth.user.id, channel: NotificationChannel.IN_APP, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
