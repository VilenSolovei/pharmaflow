import { orderActions, orderStatuses } from './order-state.js';
import type { OrderAction, OrderStatus } from './order-state.js';
import { Transform, Type } from 'class-transformer';
import { IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class CartRevisionDto {
  @IsInt() @Min(0) @Max(2147483646) revision!: number;
}
export class QuoteDto extends CartRevisionDto {
  @Transform(trimmed) @IsUUID() pharmacyId!: string;
  @IsIn(['PICKUP','COURIER']) mode!: 'PICKUP'|'COURIER';
}
export class OrderContactDto {
  @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @Transform(trimmed) @IsString() @MaxLength(30) @Matches(/^\+?(?:[ ()-]*\d){7,15}[ ()-]*$/) phone!: string;
  @Transform(trimmed) @IsEmail() @MaxLength(254) email!: string;
}
export class PostalAddressDto {
  @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(200) street!: string;
  @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(30) building!: string;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(30) apartment?: string;
}
export class CheckoutDto {
  @IsUUID() quoteId!: string;
  @IsUUID() requestId!: string;
  @IsDefined() @ValidateNested() @Type(()=>OrderContactDto) contact!: OrderContactDto;
  @IsOptional() @ValidateNested() @Type(()=>PostalAddressDto) address?: PostalAddressDto;
}
export class OrdersQueryDto {
  @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

export class AdminOrdersQueryDto extends OrdersQueryDto {
  @IsIn(['ACTIVE','ALL',...orderStatuses]) status:OrderStatus|'ACTIVE'|'ALL'='ACTIVE';
}
export class OrderActionDto {
  @IsIn(orderActions) action!:OrderAction;
  @IsIn(orderStatuses) expectedStatus!:OrderStatus;
  @IsUUID() requestId!:string;
}
