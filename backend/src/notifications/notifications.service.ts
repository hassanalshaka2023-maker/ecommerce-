import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity.js';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  notify(userId: string, message: string) {
    return this.notifications.save({ userId, message });
  }

  findAll(userId: string) {
    return this.notifications.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
