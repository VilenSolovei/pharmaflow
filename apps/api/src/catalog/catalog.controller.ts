import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CatalogQuery, PharmacyQuery } from './catalog.dto.js';
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('products') products(@Query() query: CatalogQuery) { return this.catalog.products(query); }
  @Get('products/:id') product(@Param('id',new ParseUUIDPipe()) id:string) { return this.catalog.product(id); }
  @Get('catalog/filters') filters() { return this.catalog.filters(); }
  @Get('pharmacies') pharmacies(@Query() query: PharmacyQuery) { return this.catalog.pharmacies(query); }
}
