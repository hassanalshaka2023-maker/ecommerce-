# ERD - المتطلب الأول

![ERD](erd.svg)

```mermaid
erDiagram
    users {
        uuid id PK
        varchar name
        varchar email UK
        varchar password_hash
        enum role "customer | admin"
        timestamp created_at
    }

    products {
        uuid id PK
        varchar name
        text description "nullable"
        decimal price "10,2"
        varchar category "indexed"
        varchar image_url "nullable"
        timestamp created_at
    }

    orders {
        uuid id PK
        uuid user_id "-> users.id"
        enum status "pending | confirmed | shipped | delivered | cancelled"
        decimal total_price "10,2"
        timestamp created_at
        timestamp updated_at
    }

    order_items {
        uuid id PK
        uuid order_id FK "-> orders.id, ON DELETE CASCADE"
        uuid product_id "-> products.id"
        int quantity
        decimal unit_price "10,2, price at purchase time"
    }

    notifications {
        uuid id PK
        uuid user_id "-> users.id"
        varchar message
        timestamp created_at
    }

    users ||..o{ orders : places
    orders ||--|{ order_items : contains
    products ||..o{ order_items : "appears in"
    users ||..o{ notifications : receives
```

## ملاحظات

- الخط المتصل بين orders و order_items هو foreign key حقيقي لأن الجدولين بنفس الوحدة، وإذا انحذف الطلب بتنحذف عناصره (cascade).
- الخطوط المنقطة ما فيها foreign key، بس منخزن الـ id. كل وحدة بتتعامل مع جداولها بس، ووحدة الطلبات بتجيب المنتج من ProductsService.
- unit_price هو سعر المنتج وقت الطلب، مشان ما يتغير الطلب القديم إذا تغير السعر.
