import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { OutboxEvent } from '../events/outbox.service.js';
import { NotificationService } from './notification.service.js';
export interface NotificationObserver {handle(event:OutboxEvent):Promise<void>;}
@Injectable()
export class AvailabilityObserver implements NotificationObserver {
  constructor(private readonly notifications:NotificationService){}
  @OnEvent('STOCK_AVAILABLE',{suppressErrors:false})
  handle(event:OutboxEvent){return this.notifications.deliverAvailability(event);}
}
@Injectable()
export class PromotionObserver implements NotificationObserver {
  constructor(private readonly notifications:NotificationService){}
  @OnEvent('PROMOTION_PUBLISHED',{suppressErrors:false})
  handle(event:OutboxEvent){return this.notifications.deliverPromotion(event);}
}
@Injectable()
export class ReminderObserver implements NotificationObserver {
  constructor(private readonly notifications:NotificationService){}
  @OnEvent('REMINDER_DUE',{suppressErrors:false})
  handle(event:OutboxEvent){return this.notifications.deliverReminder(event);}
}
