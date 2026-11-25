import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, AdminGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { CreatePromotionDto, LoyaltyQueryDto, LoyaltySearchDto, SocialEligibilityDto, TierDto, UpdatePromotionDto } from './loyalty.dto.js';
import { LoyaltyService } from './loyalty.service.js';
@Controller('loyalty') @UseGuards(SessionGuard,AccountOwnerGuard)
export class LoyaltyController {
  constructor(private readonly loyalty:LoyaltyService){}
  @Get() @Header('Cache-Control','no-store')
  card(@Req() req:AuthRequest,@Query() q:LoyaltyQueryDto){return this.loyalty.card(req.user!.id,q.page);}
}
@Controller('admin/loyalty') @UseGuards(SessionGuard,AdminGuard,AccountOwnerGuard)
export class AdminLoyaltyController {
  constructor(private readonly loyalty:LoyaltyService){}
  @Get('customers') @Header('Cache-Control','no-store')
  customers(@Req() req:AuthRequest,@Query() q:LoyaltySearchDto){return this.loyalty.customers(req.user!.id,q);}
  @Patch('customers/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  tier(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:TierDto){return this.loyalty.tier(req.user!.id,id,data);}
  @Get('products') @Header('Cache-Control','no-store')
  products(@Req() req:AuthRequest,@Query() q:LoyaltySearchDto){return this.loyalty.products(req.user!.id,q);}
  @Patch('products/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  social(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:SocialEligibilityDto){return this.loyalty.social(req.user!.id,id,data);}
  @Get('promotions') @Header('Cache-Control','no-store')
  promotions(@Req() req:AuthRequest,@Query() q:LoyaltyQueryDto){return this.loyalty.promotions(req.user!.id,q.page);}
  @Post('promotions') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  create(@Req() req:AuthRequest,@Body() data:CreatePromotionDto){return this.loyalty.createPromotion(req.user!.id,data);}
  @Patch('promotions/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  update(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:UpdatePromotionDto){return this.loyalty.updatePromotion(req.user!.id,id,data);}
}
