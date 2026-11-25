import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { clientTiers } from './loyalty-policy.js';
import type { ClientTier } from './loyalty-policy.js';
export class LoyaltyQueryDto {
  @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
}
export class LoyaltySearchDto extends LoyaltyQueryDto {
  @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @MaxLength(160) q='';
}
export class TierDto {
  @IsIn(clientTiers) tier!:ClientTier;
  @IsInt() @Min(0) @Max(2147483646) revision!:number;
}
export class SocialEligibilityDto {
  @IsBoolean() socialEligible!:boolean;
  @IsInt() @Min(0) @Max(2147483646) revision!:number;
}
export class PromotionFieldsDto {
  @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @MinLength(1) @MaxLength(120) name!:string;
  @IsInt() @Min(1) @Max(10000) discountBps!:number;
  @IsISO8601({strict:true,strictSeparator:true}) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i) startsAt!:string;
  @IsISO8601({strict:true,strictSeparator:true}) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i) endsAt!:string;
  @IsBoolean() active!:boolean;
  @Transform(({value}:{value:unknown})=>Array.isArray(value)?value.map(v=>typeof v==='string'?v.toLowerCase():v):value)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined,{each:true}) productIds!:string[];
}
export class CreatePromotionDto extends PromotionFieldsDto {@IsUUID() requestId!:string;}
export class UpdatePromotionDto extends PromotionFieldsDto {@IsInt() @Min(0) @Max(2147483646) revision!:number;}
