import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '../common/cache.service.js';
import { Notification } from './notification.entity.js';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(Notification, 'replica')
    private readonly replica: Repository<Notification>,
    private readonly cache: CacheService,
  ) {}

  async notify(userId: string, message: string) {
    await this.notifications.save({ userId, message });
    await this.cache.markWrite(userId);
  }

  async findAll(userId: string) {
    // A user who was just notified reads the primary; the replica may not have it yet.
    const fresh = await this.cache.wroteRecently(userId);
    return (fresh ? this.notifications : this.replica).find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
