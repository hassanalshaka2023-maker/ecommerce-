import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth, type AuthUser, CurrentUser } from '../common/auth.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Auth()
  findAll(@CurrentUser() user: AuthUser) {
    return this.notifications.findAll(user.id);
  }
}
