import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { CartService } from './cart.service.js';
import { CartContentDto, CartItemDto, QuantityDto, ReplaceCartDto } from './cart.dto.js';
@Controller('cart')
export class CartController {
 constructor(private readonly cart:CartService){}
 @Post('preview') @HttpCode(200) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
 preview(@Body() data:CartContentDto){return this.cart.preview(data.items);}
 @Get() @UseGuards(SessionGuard) @Header('Cache-Control','no-store')
 get(@Req() req:AuthRequest){return this.cart.get(req.user!.id);}
 @Post('items') @HttpCode(200) @UseGuards(SessionGuard,OriginGuard,AccountOwnerGuard)
 add(@Req() req:AuthRequest,@Body() item:CartItemDto){return this.cart.add(req.user!.id,item);}
 @Patch('items/:productId') @UseGuards(SessionGuard,OriginGuard,AccountOwnerGuard)
 quantity(@Req() req:AuthRequest,@Param('productId',new ParseUUIDPipe()) id:string,@Body() data:QuantityDto){return this.cart.quantity(req.user!.id,id,data.quantity);}
 @Delete('items/:productId') @UseGuards(SessionGuard,OriginGuard,AccountOwnerGuard)
 remove(@Req() req:AuthRequest,@Param('productId',new ParseUUIDPipe()) id:string){return this.cart.remove(req.user!.id,id);}
 @Put() @UseGuards(SessionGuard,OriginGuard,AccountOwnerGuard)
 replace(@Req() req:AuthRequest,@Body() data:ReplaceCartDto){return this.cart.replace(req.user!.id,data);}
}
