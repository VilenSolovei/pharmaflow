import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
export class QuantityDto {
 @IsInt() @Min(1) @Max(99) quantity!:number;
}
export class CartItemDto extends QuantityDto {
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.toLowerCase():value)
 @IsUUID() productId!:string;
}
export class CartContentDto {
 @IsArray() @ArrayMaxSize(100) @ArrayUnique((item:CartItemDto|null)=>item?.productId)
 @ValidateNested({each:true}) @Type(()=>CartItemDto) items!:CartItemDto[];
}
export class ReplaceCartDto extends CartContentDto {
 @IsInt() @Min(0) @Max(2147483646) revision!:number;
}
