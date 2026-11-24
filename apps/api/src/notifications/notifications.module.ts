import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OutboxModule } from '../events/outbox.service.js';
import { NotificationService } from './notification.service.js';
import { NotificationsController } from './notifications.controller.js';
import { AvailabilityObserver, PromotionObserver, ReminderObserver } from './notification.observers.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { ReminderService } from './reminder.service.js';
@Module({imports:[AuthModule,OutboxModule],controllers:[NotificationsController],providers:[NotificationService,AvailabilityObserver,PromotionObserver,ReminderObserver,ReminderService,OutboxDispatcher]})
export class NotificationsModule {}
