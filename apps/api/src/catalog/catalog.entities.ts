import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('categories')
export class Category {
  @PrimaryColumn('uuid') id!: string;
  @Column({ length:100, unique:true }) name!: string;
}
@Entity('manufacturers')
export class Manufacturer {
  @PrimaryColumn('uuid') id!: string;
  @Column({ length:100, unique:true }) name!: string;
}
@Entity('products')
export class Product {
  @PrimaryColumn('uuid') id!: string;
  @Column({ length:160 }) name!: string;
  @Column('text') description!: string;
  @Column({type:'varchar',length:20}) type!: 'MEDICINE'|'VITAMIN'|'MEDICAL_DEVICE';
  @Column({name:'price_minor',type:'integer'}) priceMinor!: number;
  @Column({name:'requires_prescription'}) requiresPrescription!: boolean;
  @Column({name:'social_eligible',default:false}) socialEligible!: boolean;
  @Column({default:true}) active!: boolean;
  @Column({name:'category_id',type:'uuid'}) categoryId!: string;
  @Column({name:'manufacturer_id',type:'uuid'}) manufacturerId!: string;
}
@Entity('pharmacies')
export class Pharmacy {
  @PrimaryColumn('uuid') id!: string;
  @Column({length:100}) name!: string;
  @Column({length:200}) address!: string;
  @Column('double precision') latitude!: number;
  @Column('double precision') longitude!: number;
  @Column({default:true}) active!: boolean;
}
@Entity('stock_items')
export class StockItem {
  @PrimaryColumn('uuid') id!: string;
  @Column({name:'pharmacy_id',type:'uuid'}) pharmacyId!: string;
  @Column({name:'product_id',type:'uuid'}) productId!: string;
  @Column({name:'on_hand',type:'integer'}) onHand!: number;
  @Column({type:'integer',default:0}) reserved!: number;
  get available():number { return this.onHand-this.reserved; }
}
