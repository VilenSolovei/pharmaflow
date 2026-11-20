import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, AdminGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { AdminOrdersQueryDto, OrderActionDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';
@Controller('admin/orders')
@UseGuards(SessionGuard,AdminGuard,AccountOwnerGuard)
export class AdminOrdersController {
  constructor(private readonly orders:OrdersService){}
  @Get() @Header('Cache-Control','no-store')
  list(@Req() req:AuthRequest,@Query() query:AdminOrdersQueryDto){return this.orders.adminList(req.user!.id,query);}
  @Get(':id') @Header('Cache-Control','no-store')
  get(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.orders.adminGet(req.user!.id,id);}
  @Post(':id/actions') @HttpCode(200) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  action(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:OrderActionDto){return this.orders.adminAction(req.user!.id,id,data);}
}
