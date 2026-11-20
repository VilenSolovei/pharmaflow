import { Transform, Type } from 'class-transformer';
import { IsInt, IsISO8601, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class RevisionDto {
  @IsInt() @Min(0) @Max(2147483646) revision!:number;
}
export class ProfileDto extends RevisionDto {
  @Transform(trim) @IsString() @MaxLength(100) name!:string;
  @Transform(trim) @IsString() @MaxLength(30) @Matches(/^$|^\+?(?:[ ()-]*\d){7,15}[ ()-]*$/) phone!:string;
}
export class PrescriptionFieldsDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) number!:string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({strict:true}) issuedOn!:string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) medication!:string;
  @Transform(trim) @IsString() @MaxLength(1000) notes!:string;
}
export class CreatePrescriptionDto extends PrescriptionFieldsDto {
  @IsUUID() requestId!:string;
}
export class UpdatePrescriptionDto extends PrescriptionFieldsDto {
  @IsInt() @Min(0) @Max(2147483646) revision!:number;
}
export class PrescriptionsQueryDto {
  @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
}
