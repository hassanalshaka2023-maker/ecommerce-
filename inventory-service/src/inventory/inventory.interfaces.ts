// Message shapes from src/proto/inventory.proto. The proto loader converts
// snake_case field names to camelCase, so product_id arrives as productId.

export interface GetStockRequest {
  productId: string;
}

export interface StockResponse {
  productId: string;
  quantity: number;
}

export interface ReserveItem {
  productId: string;
  quantity: number;
}

export interface ReserveRequest {
  orderRef: string;
  items: ReserveItem[];
}

export interface ReserveResponse {
  success: boolean;
}

export interface ReleaseRequest {
  orderRef: string;
}

export interface ReleaseResponse {
  released: boolean;
}

export interface SetStockRequest {
  productId: string;
  quantity: number;
}
