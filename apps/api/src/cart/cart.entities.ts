import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('carts')
export class Cart {
 @PrimaryColumn('uuid') id!:string;
 @Column({name:'user_id',type:'uuid',unique:true}) userId!:string;
 @Column({type:'integer',default:0}) revision!:number;
}
@Entity('cart_items')
export class CartItem {
 @PrimaryColumn('uuid') id!:string;
 @Column({name:'cart_id',type:'uuid'}) cartId!:string;
 @Column({name:'product_id',type:'uuid'}) productId!:string;
 @Column({type:'integer'}) quantity!:number;
}
