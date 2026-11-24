import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { CreateReminderDto, DeleteReminderDto, NotificationPreferencesDto, NotificationReadDto, NotificationsQueryDto, SubscriptionDto, UpdateReminderDto } from './notifications.dto.js';
import { NotificationService } from './notification.service.js';
@Controller('notifications') @UseGuards(SessionGuard,AccountOwnerGuard)
export class NotificationsController {
  constructor(private readonly notifications:NotificationService){}
  @Get() @Header('Cache-Control','no-store')
  list(@Req() req:AuthRequest,@Query() q:NotificationsQueryDto){return this.notifications.list(req.user!.id,q);}
  @Get('summary') @Header('Cache-Control','no-store')
  summary(@Req() req:AuthRequest){return this.notifications.summary(req.user!.id);}
  @Get('preferences') @Header('Cache-Control','no-store')
  preferences(@Req() req:AuthRequest){return this.notifications.preferences(req.user!.id);}
  @Patch('preferences') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  updatePreferences(@Req() req:AuthRequest,@Body() data:NotificationPreferencesDto){return this.notifications.updatePreferences(req.user!.id,data);}
  @Post('read-all') @HttpCode(200) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  readAll(@Req() req:AuthRequest){return this.notifications.readAll(req.user!.id);}
  @Patch(':id/read') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  read(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:NotificationReadDto){return this.notifications.read(req.user!.id,id,data.read);}
  @Get('subscriptions') @Header('Cache-Control','no-store')
  subscriptions(@Req() req:AuthRequest){return this.notifications.subscriptions(req.user!.id);}
  @Post('subscriptions') @HttpCode(200) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  subscribe(@Req() req:AuthRequest,@Body() data:SubscriptionDto){return this.notifications.subscribe(req.user!.id,data.productId,data.pharmacyId);}
  @Delete('subscriptions/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  unsubscribe(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.notifications.unsubscribe(req.user!.id,id);}
  @Get('reminders') @Header('Cache-Control','no-store')
  reminders(@Req() req:AuthRequest){return this.notifications.reminders(req.user!.id);}
  @Post('reminders') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  createReminder(@Req() req:AuthRequest,@Body() data:CreateReminderDto){return this.notifications.createReminder(req.user!.id,data);}
  @Patch('reminders/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  updateReminder(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:UpdateReminderDto){return this.notifications.updateReminder(req.user!.id,id,data);}
  @Delete('reminders/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  deleteReminder(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:DeleteReminderDto){return this.notifications.deleteReminder(req.user!.id,id,data.revision);}
}
