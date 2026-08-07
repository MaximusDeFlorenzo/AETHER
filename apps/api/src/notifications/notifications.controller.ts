import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

// Public feed — broadcast notifications (new-hazard-event alerts, etc.) are
// visible to anyone, same posture as the rest of the public dashboard's read
// endpoints. `@CurrentUser()` is undefined for anonymous visitors; when a
// staff member is logged in, their user-targeted notifications are
// additionally included.
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('unread') unread?: string,
  ) {
    return this.notificationsService.findForUser(user?.id, unread === 'true');
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markRead(id);
  }

  @Patch('read-all')
  markAllRead() {
    return this.notificationsService.markAllRead();
  }
}
