export class CatalogAdminError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface NamedRecord { id: string; name: string; revision: number; }
export interface AdminProduct extends NamedRecord { description: string; type: string; priceMinor: number; requiresPrescription: boolean; active: boolean; categoryId: string; manufacturerId: string; }
export interface AdminPharmacy extends NamedRecord { address: string; latitude: number; longitude: number; active: boolean; }
export interface AdminStock { productId: string; name: string; active: boolean; onHand: number; reserved: number; available: number; }
export interface StockHistory { id: string; productName: string; pharmacyName: string; beforeOnHand: number; afterOnHand: number; reserved: number; reason: string; createdAt: string; actorEmail: string; }
export interface AdminList<T> { ownerId: string; items: T[]; total: number; page: number; limit: number; }
export interface AdminReferences { ownerId: string; categories: Pick<NamedRecord, 'id' | 'name'>[]; manufacturers: Pick<NamedRecord, 'id' | 'name'>[]; pharmacies: { id: string; name: string; active: boolean }[]; }
export async function catalogAdminRequest<T>(path: string, uid: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/admin/catalog' + path, { method, credentials: 'same-origin', signal: signal ?? AbortSignal.timeout(15000), headers: { 'X-PharmaFlow-User': uid, ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-PharmaFlow-Request': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (error) { throw new Error('Не вдалося отримати відповідь сервера. Перевірте з’єднання та повторіть запит.', { cause: error }); }
  const data = await response.json().catch(() => ({ message: 'Сервіс тимчасово недоступний.' }));
  if (!response.ok) throw new CatalogAdminError(response.status, typeof data.message === 'string' ? data.message : 'Перевірте поля форми.');
  if (data.ownerId !== uid) throw new CatalogAdminError(409, 'Обліковий запис змінився. Оновіть сторінку.');
  return data as T;
}
