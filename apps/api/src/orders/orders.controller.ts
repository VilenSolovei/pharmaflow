import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { CartRevisionDto, CheckoutDto, OrdersQueryDto, QuoteDto, RepeatOrderDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';
@Controller('orders')
@UseGuards(SessionGuard,AccountOwnerGuard)
export class OrdersController {
  constructor(private readonly orders:OrdersService) {}
  @Header('Cache-Control','no-store') @Post('options') @HttpCode(200) @UseGuards(OriginGuard)
  options(@Req() req:AuthRequest,@Body() data:CartRevisionDto){return this.orders.options(req.user!.id,data.revision);}
  @Header('Cache-Control','no-store') @Post('quote') @HttpCode(200) @UseGuards(OriginGuard)
  quote(@Req() req:AuthRequest,@Body() data:QuoteDto){return this.orders.quote(req.user!.id,data);}
  @Header('Cache-Control','no-store') @Post() @UseGuards(OriginGuard)
  create(@Req() req:AuthRequest,@Body() data:CheckoutDto){return this.orders.create(req.user!.id,data);}
  @Header('Cache-Control','no-store') @Get()
  list(@Req() req:AuthRequest,@Query() query:OrdersQueryDto){return this.orders.list(req.user!.id,query.page);}
  @Header('Cache-Control','no-store') @Get(':id')
  get(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.orders.get(req.user!.id,id);}
  @Post(':id/repeat-preview') @HttpCode(200) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  repeatPreview(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.orders.repeatPreview(req.user!.id,id);}
  @Post(':id/repeat') @HttpCode(200) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  repeat(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:RepeatOrderDto){return this.orders.repeat(req.user!.id,id,data.revision,data.requestId);}
  @Header('Cache-Control','no-store') @Post(':id/cancel') @HttpCode(200) @UseGuards(OriginGuard)
  cancel(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.orders.cancel(req.user!.id,id);}
}
