import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { AccountService } from './account.service.js';
import { CreatePrescriptionDto, PrescriptionsQueryDto, ProfileDto, RevisionDto, UpdatePrescriptionDto } from './account.dto.js';
@Controller('account')
@UseGuards(SessionGuard,AccountOwnerGuard)
export class AccountController {
  constructor(private readonly account:AccountService){}
  @Get() @Header('Cache-Control','no-store')
  get(@Req() req:AuthRequest){return this.account.get(req.user!.id);}
  @Patch() @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  update(@Req() req:AuthRequest,@Body() data:ProfileDto){return this.account.update(req.user!.id,data);}
  @Get('prescriptions') @Header('Cache-Control','no-store')
  list(@Req() req:AuthRequest,@Query() query:PrescriptionsQueryDto){return this.account.list(req.user!.id,query.page);}
  @Post('prescriptions') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  create(@Req() req:AuthRequest,@Body() data:CreatePrescriptionDto){return this.account.create(req.user!.id,data);}
  @Get('prescriptions/:id') @Header('Cache-Control','no-store')
  prescription(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.account.getPrescription(req.user!.id,id);}
  @Patch('prescriptions/:id') @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  edit(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:UpdatePrescriptionDto){return this.account.updatePrescription(req.user!.id,id,data);}
  @Delete('prescriptions/:id') @HttpCode(204) @UseGuards(OriginGuard) @Header('Cache-Control','no-store')
  remove(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() data:RevisionDto){return this.account.removePrescription(req.user!.id,id,data.revision);}
}
