import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsUUID, Matches, Max, Min } from 'class-validator';
export class NotificationsQueryDto {
  @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
  @IsIn(['true','false']) unreadOnly='false';
}
export class NotificationReadDto {@IsBoolean() read!:boolean;}
export class NotificationPreferencesDto {
  @IsBoolean() promotionOptIn!:boolean;
  @IsInt() @Min(0) @Max(2147483646) revision!:number;
}
export class SubscriptionDto {@IsUUID() productId!:string;@IsUUID() pharmacyId!:string;}
export class ReminderFieldsDto {
  @IsUUID() productId!:string;
  @IsISO8601({strict:true,strictSeparator:true}) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i) nextAt!:string;
  @IsInt() @Min(1) @Max(365) intervalDays!:number;
  @IsBoolean() active!:boolean;
}
export class CreateReminderDto extends ReminderFieldsDto {@IsUUID() requestId!:string;}
export class UpdateReminderDto extends ReminderFieldsDto {@IsInt() @Min(0) @Max(2147483646) revision!:number;}
export class DeleteReminderDto {@IsInt() @Min(0) @Max(2147483646) revision!:number;}
