import { TypeOrmModule } from '@nestjs/typeorm';
import { Category, Manufacturer, Product, Pharmacy, StockItem } from './catalog.entities.js';
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
@Module({imports:[TypeOrmModule.forFeature([Category,Manufacturer,Product,Pharmacy,StockItem])],controllers:[CatalogController],providers:[CatalogService]})
export class CatalogModule {}
