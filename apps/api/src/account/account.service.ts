import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreatePrescriptionDto, ProfileDto, UpdatePrescriptionDto } from './account.dto.js';
interface Profile {ownerId:string;email:string;name:string;phone:string;role:string;tier:string;revision:number;}
interface PrescriptionRow {id:string;ownerId:string;number:string;issuedOn:string;medication:string;notes:string;revision:number;createdAt:Date;updatedAt:Date;}
const prescriptionFields='id,user_id "ownerId",number,to_char(issued_on,\'YYYY-MM-DD\') "issuedOn",medication,notes,revision,created_at "createdAt",updated_at "updatedAt"';
@Injectable()
export class AccountService {
  constructor(private readonly db:DataSource){}
  private async lockUser(m:EntityManager,userId:string){
    const rows:unknown[]=await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    if(!rows.length)throw new UnauthorizedException();
  }
  private async profile(m:EntityManager,userId:string){
    const rows:Profile[]=await m.query(`SELECT id "ownerId",email,full_name name,coalesce(phone,'') phone,role,tier,profile_revision revision FROM users WHERE id=$1`,[userId]);
    if(!rows[0])throw new UnauthorizedException();return rows[0];
  }
  get(userId:string){return this.profile(this.db.manager,userId);}
  async update(userId:string,data:ProfileDto){
    return this.db.transaction(async m=>{
      await this.lockUser(m,userId);const current=await this.profile(m,userId);
      if(current.revision!==data.revision)throw new ConflictException('Профіль змінився в іншому вікні. Завантажте актуальні дані перед збереженням.');
      await m.query('UPDATE users SET full_name=$2,phone=$3,profile_revision=profile_revision+1 WHERE id=$1',[userId,data.name,data.phone||null]);
      return this.profile(m,userId);
    });
  }
  private validateDate(value:string){
    if(value<'0001-01-01'||value>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))throw new BadRequestException('Дата видачі має бути дійсною та не пізнішою за сьогодні.');
  }
  private async prescription(m:EntityManager,userId:string,id:string,lock=false){
    const rows:PrescriptionRow[]=await m.query(`SELECT ${prescriptionFields} FROM prescriptions WHERE id=$1 AND user_id=$2 ${lock?'FOR UPDATE':''}`,[id,userId]);
    if(!rows[0])throw new NotFoundException('Запис рецепта не знайдено.');return rows[0];
  }
  async list(userId:string,page:number){
    return this.db.transaction('REPEATABLE READ',async m=>{
      const [{total}]:{total:number}[]=await m.query('SELECT count(*)::integer total FROM prescriptions WHERE user_id=$1',[userId]);
      const items:PrescriptionRow[]=await m.query(`SELECT ${prescriptionFields} FROM prescriptions WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2`,[userId,(page-1)*20]);
      return {ownerId:userId,items,total,page,limit:20};
    });
  }
  getPrescription(userId:string,id:string){return this.prescription(this.db.manager,userId,id);}
  async create(userId:string,data:CreatePrescriptionDto){
    this.validateDate(data.issuedOn);
    const fingerprint=createHash('sha256').update(JSON.stringify({number:data.number,issuedOn:data.issuedOn,medication:data.medication,notes:data.notes})).digest('hex');
    return this.db.transaction(async m=>{
      await this.lockUser(m,userId);
      const previous:{id:string;requestHash:string}[]=await m.query('SELECT id,request_hash "requestHash" FROM prescriptions WHERE user_id=$1 AND request_id=$2',[userId,data.requestId]);
      if(previous[0]){
        if(previous[0].requestHash!==fingerprint)throw new ConflictException('Цей запит уже використано для іншого запису. Оновіть список.');
        return this.prescription(m,userId,previous[0].id);
      }
      const id=randomUUID();
      await m.query('INSERT INTO prescriptions(id,user_id,number,issued_on,medication,notes,request_id,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,userId,data.number,data.issuedOn,data.medication,data.notes,data.requestId,fingerprint]);
      return this.prescription(m,userId,id);
    });
  }
  async updatePrescription(userId:string,id:string,data:UpdatePrescriptionDto){
    this.validateDate(data.issuedOn);
    return this.db.transaction(async m=>{
      const current=await this.prescription(m,userId,id,true);
      if(current.revision!==data.revision)throw new ConflictException('Запис рецепта вже змінився. Оновіть список і відкрийте його ще раз.');
      await m.query('UPDATE prescriptions SET number=$2,issued_on=$3,medication=$4,notes=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[id,data.number,data.issuedOn,data.medication,data.notes]);
      return this.prescription(m,userId,id);
    });
  }
  async removePrescription(userId:string,id:string,revision:number){
    return this.db.transaction(async m=>{
      const current=await this.prescription(m,userId,id,true);
      if(current.revision!==revision)throw new ConflictException('Запис рецепта вже змінився. Перевірте його перед видаленням.');
      await m.query('DELETE FROM prescriptions WHERE id=$1',[id]);
    });
  }
}
