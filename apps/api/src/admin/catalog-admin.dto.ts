import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class AdminListQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Transform(trim) @IsString() @MaxLength(160) q = '';
  @IsIn(['all', 'active', 'inactive']) status = 'all';
}
export class StockQuery extends AdminListQuery {
  @IsOptional() @IsUUID() pharmacyId?: string;
  @IsOptional() @IsUUID() productId?: string;
}
export class AdminRequestDto { @IsUUID() requestId!: string; }
export class AdminVersionDto extends AdminRequestDto { @IsInt() @Min(0) @Max(2147483646) revision!: number; }
export class NamedFieldsDto extends AdminRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name!: string;
}
export class UpdateNamedDto extends NamedFieldsDto { @IsInt() @Min(0) @Max(2147483646) revision!: number; }
export class ProductFieldsDto extends AdminRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @Transform(trim) @IsString() @MaxLength(10000) description!: string;
  @IsIn(['MEDICINE', 'VITAMIN', 'MEDICAL_DEVICE']) type!: string;
  @IsInt() @Min(0) @Max(100000000) priceMinor!: number;
  @IsBoolean() requiresPrescription!: boolean;
  @IsBoolean() active!: boolean;
  @IsUUID() categoryId!: string;
  @IsUUID() manufacturerId!: string;
}
export class UpdateProductDto extends ProductFieldsDto { @IsInt() @Min(0) @Max(2147483646) revision!: number; }
export class PharmacyFieldsDto extends NamedFieldsDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) address!: string;
  @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(-90) @Max(90) latitude!: number;
  @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(-180) @Max(180) longitude!: number;
  @IsBoolean() active!: boolean;
}
export class UpdatePharmacyDto extends PharmacyFieldsDto { @IsInt() @Min(0) @Max(2147483646) revision!: number; }
export class StockAdjustmentDto extends AdminRequestDto {
  @IsUUID() productId!: string;
  @IsUUID() pharmacyId!: string;
  @IsInt() @Min(0) @Max(2147483647) expectedOnHand!: number;
  @IsInt() @Min(0) @Max(2147483647) expectedReserved!: number;
  @IsInt() @Min(0) @Max(2147483647) onHand!: number;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
