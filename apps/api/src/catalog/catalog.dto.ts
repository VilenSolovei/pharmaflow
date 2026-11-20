import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
export class CatalogQuery {
  @IsOptional() @Transform(({value}: {value: unknown}) => typeof value === 'string' ? value.trim() : value) @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() manufacturerId?: string;
  @IsOptional() @IsUUID() pharmacyId?: string;
  @IsOptional() @IsIn(['MEDICINE','VITAMIN','MEDICAL_DEVICE']) type?: string;
  @IsOptional() @IsIn(['true','false']) requiresPrescription?: string;
  @IsOptional() @IsIn(['true','false']) inStock?: string;
  @IsOptional() @Matches(/^\d{1,7}(\.\d{1,2})?$/) minPrice?: string;
  @IsOptional() @Matches(/^\d{1,7}(\.\d{1,2})?$/) maxPrice?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) limit = 12;
  @IsOptional() @IsIn(['name','price_asc','price_desc']) sort = 'name';
}
export class PharmacyQuery {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
}
