import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CatalogQuery, PharmacyQuery } from './catalog.dto.js';
interface ProductRow {
  id: string; name: string; description: string; type: string; priceMinor: number;
  requiresPrescription: boolean; categoryId: string; category: string; manufacturerId: string;
  manufacturer: string; available: number;
}
@Injectable()
export class CatalogService {
  constructor(private readonly db: DataSource) {}
  async filters() {
    const categories = await this.db.query('SELECT id,name FROM categories ORDER BY name,id');
    const manufacturers = await this.db.query('SELECT id,name FROM manufacturers ORDER BY name,id');
    return { categories, manufacturers };
  }
  async products(q: CatalogQuery) {
    if (q.minPrice && q.maxPrice && Number(q.minPrice) > Number(q.maxPrice)) throw new BadRequestException('Мінімальна ціна перевищує максимальну.');
    const values: unknown[] = [];
    const bind = (v: unknown) => { values.push(v); return '$' + values.length; };
    const pharmacy = q.pharmacyId ? `AND s.pharmacy_id=${bind(q.pharmacyId)}` : '';
    const base = `WITH stock AS (SELECT s.product_id, sum(s.on_hand-s.reserved)::integer available
      FROM stock_items s JOIN pharmacies ph ON ph.id=s.pharmacy_id AND ph.active WHERE true ${pharmacy} GROUP BY s.product_id)
      `;
    const from = `FROM products p JOIN categories c ON c.id=p.category_id JOIN manufacturers m ON m.id=p.manufacturer_id
      LEFT JOIN stock ON stock.product_id=p.id`;
    const where = ['p.active'];
    if (q.q) { const escaped=q.q.replace(/[\\%_]/g, '\\$&'); const v=bind('%'+escaped+'%'); where.push(`(p.name ILIKE ${v} OR c.name ILIKE ${v} OR m.name ILIKE ${v})`); }
    if (q.categoryId) where.push(`p.category_id=${bind(q.categoryId)}`);
    if (q.manufacturerId) where.push(`p.manufacturer_id=${bind(q.manufacturerId)}`);
    if (q.type) where.push(`p.type=${bind(q.type)}`);
    if (q.requiresPrescription) where.push(`p.requires_prescription=${bind(q.requiresPrescription === 'true')}`);
    if (q.minPrice) where.push(`p.price_minor >= ${bind(Math.round(Number(q.minPrice)*100))}`);
    if (q.maxPrice) where.push(`p.price_minor <= ${bind(Math.round(Number(q.maxPrice)*100))}`);
    if (q.inStock) where.push(q.inStock==='true' ? 'coalesce(stock.available,0)>0' : 'coalesce(stock.available,0)=0');
    const clause = where.join(' AND ');
    const count: {total:number}[] = await this.db.query(`${base} SELECT count(*)::integer total ${from} WHERE ${clause}`, values);
    const order = { name:'p.name,p.id', price_asc:'p.price_minor,p.id', price_desc:'p.price_minor DESC,p.id' }[q.sort as 'name'];
    const limit=bind(q.limit),offset=bind((q.page-1)*q.limit);
    const items: ProductRow[] = await this.db.query(`${base} SELECT p.id,p.name,p.description,p.type,
      p.price_minor "priceMinor",p.requires_prescription "requiresPrescription",c.id "categoryId",c.name category,
      m.id "manufacturerId",m.name manufacturer,coalesce(stock.available,0)::integer available
      ${from} WHERE ${clause} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, values);
    return { items, total:count[0].total, page:q.page, limit:q.limit };
  }
  async product(id: string) {
    const rows: ProductRow[] = await this.db.query(`SELECT p.id,p.name,p.description,p.type,p.price_minor "priceMinor",
      p.requires_prescription "requiresPrescription", c.name category,m.name manufacturer FROM products p
      JOIN categories c ON c.id=p.category_id JOIN manufacturers m ON m.id=p.manufacturer_id WHERE p.id=$1 AND p.active`,[id]);
    if (!rows[0]) throw new NotFoundException('Товар не знайдено.');
    const pharmacies = await this.db.query(`SELECT ph.id,ph.name,ph.address,
      coalesce(s.on_hand-s.reserved,0)::integer available FROM pharmacies ph
      LEFT JOIN stock_items s ON s.pharmacy_id=ph.id AND s.product_id=$1 WHERE ph.active ORDER BY ph.name,ph.id`,[id]);
    return { ...rows[0], pharmacies };
  }
  async pharmacies(q: PharmacyQuery) {
    if ((q.latitude===undefined)!==(q.longitude===undefined)) throw new BadRequestException('Потрібні обидві координати.');
    const rows: {id:string;name:string;address:string;latitude:number;longitude:number}[] = await this.db.query('SELECT id,name,address,latitude,longitude FROM pharmacies WHERE active ORDER BY name,id');
    if (q.latitude===undefined || q.longitude===undefined) return rows;
    const rad=(v:number)=>v*Math.PI/180;
    const latitude=q.latitude,longitude=q.longitude;
    return rows.map(p=>{ const a=Math.sin(rad(p.latitude-latitude)/2)**2+Math.cos(rad(latitude))*Math.cos(rad(p.latitude))*Math.sin(rad(p.longitude-longitude)/2)**2;
      return {...p,distanceKm:Math.round(6371*2*Math.asin(Math.sqrt(Math.min(1,a)))*100)/100};
    }).sort((a,b)=>a.distanceKm-b.distanceKm || a.id.localeCompare(b.id));
  }
}
