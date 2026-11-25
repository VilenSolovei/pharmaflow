import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountOwnerGuard, AdminGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.guards.js';
import { AdminListQuery, AdminVersionDto, NamedFieldsDto, PharmacyFieldsDto, ProductFieldsDto, StockAdjustmentDto, StockQuery, UpdateNamedDto, UpdatePharmacyDto, UpdateProductDto } from './catalog-admin.dto.js';
import { CatalogAdminService } from './catalog-admin.service.js';

@Controller('admin/catalog')
@UseGuards(SessionGuard, AdminGuard, AccountOwnerGuard)
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}
  @Header('Cache-Control', 'no-store') @Get('references') references(@Req() r: AuthRequest) { return this.catalog.references(r.user!.id); }
  @Header('Cache-Control', 'no-store') @Get('products') products(@Req() r: AuthRequest, @Query() q: AdminListQuery) { return this.catalog.products(r.user!.id, q); }
  @Header('Cache-Control', 'no-store') @Post('products') @UseGuards(OriginGuard)
  createProduct(@Req() r: AuthRequest, @Body() d: ProductFieldsDto) { return this.catalog.createProduct(r.user!.id, d); }
  @Header('Cache-Control', 'no-store') @Patch('products/:id') @UseGuards(OriginGuard)
  updateProduct(@Req() r: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() d: UpdateProductDto) { return this.catalog.updateProduct(r.user!.id, id, d); }
  @Header('Cache-Control', 'no-store') @Get('pharmacies') pharmacies(@Req() r: AuthRequest, @Query() q: AdminListQuery) { return this.catalog.pharmacies(r.user!.id, q); }
  @Header('Cache-Control', 'no-store') @Post('pharmacies') @UseGuards(OriginGuard)
  createPharmacy(@Req() r: AuthRequest, @Body() d: PharmacyFieldsDto) { return this.catalog.createPharmacy(r.user!.id, d); }
  @Header('Cache-Control', 'no-store') @Patch('pharmacies/:id') @UseGuards(OriginGuard)
  updatePharmacy(@Req() r: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() d: UpdatePharmacyDto) { return this.catalog.updatePharmacy(r.user!.id, id, d); }
  @Header('Cache-Control', 'no-store') @Get('categories') categories(@Req() r: AuthRequest, @Query() q: AdminListQuery) { return this.catalog.named(r.user!.id, 'categories', q); }
  @Header('Cache-Control', 'no-store') @Post('categories') @UseGuards(OriginGuard)
  createCategory(@Req() r: AuthRequest, @Body() d: NamedFieldsDto) { return this.catalog.createNamed(r.user!.id, 'categories', d); }
  @Header('Cache-Control', 'no-store') @Patch('categories/:id') @UseGuards(OriginGuard)
  updateCategory(@Req() r: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() d: UpdateNamedDto) { return this.catalog.updateNamed(r.user!.id, 'categories', id, d); }
  @Header('Cache-Control', 'no-store') @Delete('categories/:id') @UseGuards(OriginGuard)
  deleteCategory(@Req() r: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() d: AdminVersionDto) { return this.catalog.deleteNamed(r.user!.id, 'categories', id, d); }
  @Header('Cache-Control', 'no-store') @Get('manufacturers') manufacturers(@Req() r: AuthRequest, @Query() q: AdminListQuery) { return this.catalog.named(r.user!.id, 'manufacturers', q); }
  @Header('Cache-Control', 'no-store') @Post('manufacturers') @UseGuards(OriginGuard)
  createManufacturer(@Req() r: AuthRequest, @Body() d: NamedFieldsDto) { return this.catalog.createNamed(r.user!.id, 'manufacturers', d); }
  @Header('Cache-Control', 'no-store') @Patch('manufacturers/:id') @UseGuards(OriginGuard)
  updateManufacturer(@Req() r: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() d: UpdateNamedDto) { return this.catalog.updateNamed(r.user!.id, 'manufacturers', id, d); }
  @Header('Cache-Control', 'no-store') @Delete('manufacturers/:id') @UseGuards(OriginGuard)
  deleteManufacturer(@Req() r: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() d: AdminVersionDto) { return this.catalog.deleteNamed(r.user!.id, 'manufacturers', id, d); }
  @Header('Cache-Control', 'no-store') @Get('stock') stock(@Req() r: AuthRequest, @Query() q: StockQuery) { return this.catalog.stock(r.user!.id, q); }
  @Header('Cache-Control', 'no-store') @Post('stock/adjustments') @HttpCode(200) @UseGuards(OriginGuard)
  adjust(@Req() r: AuthRequest, @Body() d: StockAdjustmentDto) { return this.catalog.adjustStock(r.user!.id, d); }
  @Header('Cache-Control', 'no-store') @Get('stock/history') history(@Req() r: AuthRequest, @Query() q: StockQuery) { return this.catalog.history(r.user!.id, q); }
}
