import type { Observable } from 'rxjs';

// Client-side view of the InventoryService in src/proto/inventory.proto.
// The proto loader converts snake_case field names to camelCase.

export interface StockResponse {
  productId: string;
  quantity: number;
}

export interface ReserveItem {
  productId: string;
  quantity: number;
}

export interface InventoryGrpcService {
  getStock(request: { productId: string }): Observable<StockResponse>;
  setStock(request: { productId: string; quantity: number }): Observable<StockResponse>;
  reserve(request: { orderRef: string; items: ReserveItem[] }): Observable<{ success: boolean }>;
  release(request: { orderRef: string }): Observable<{ released: boolean }>;
}
