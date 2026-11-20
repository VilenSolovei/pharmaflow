import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('prescriptions')
export class Prescription {
  @PrimaryColumn('uuid') id!:string;
  @Column({name:'user_id',type:'uuid'}) userId!:string;
  @Column({type:'varchar',length:80}) number!:string;
  @Column({name:'issued_on',type:'date'}) issuedOn!:string;
  @Column({type:'varchar',length:160}) medication!:string;
  @Column({type:'varchar',length:1000}) notes!:string;
  @Column({type:'integer',default:0}) revision!:number;
  @Column({name:'request_id',type:'uuid'}) requestId!:string;
  @Column({name:'request_hash',type:'char',length:64,select:false}) requestHash!:string;
  @Column({name:'created_at',type:'timestamptz'}) createdAt!:Date;
  @Column({name:'updated_at',type:'timestamptz'}) updatedAt!:Date;
}
