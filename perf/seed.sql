-- Fake data at a realistic size, so slow queries actually show up.
-- Run (PowerShell, from the project folder):
--   Get-Content perf/seed.sql | docker compose -p ecommerce-local exec -T db psql -U postgres -d ecommerce
-- Every seeded customer logs in with: customer<N>@seed.local / Passw0rd!

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- 2,000 customers (one bcrypt hash shared by all, hashing 2,000 times is slow).
INSERT INTO users (name, email, password_hash)
SELECT 'Customer ' || n, 'customer' || n || '@seed.local', h.hash
FROM generate_series(1, 2000) AS n,
     (SELECT crypt('Passw0rd!', gen_salt('bf', 10)) AS hash) AS h;

-- 10,000 products in 20 categories.
INSERT INTO products (name, description, price, category, created_at)
SELECT 'Product ' || n,
       'Description of product ' || n,
       round((random() * 490 + 10)::numeric, 2),
       'category-' || (n % 20 + 1),
       now() - random() * interval '365 days'
FROM generate_series(1, 10000) AS n;

-- 300,000 orders spread over the customers and over the last year.
CREATE TEMP TABLE seed_customers AS
SELECT row_number() OVER () AS n, id FROM users WHERE email LIKE '%@seed.local';
CREATE TEMP TABLE seed_products AS
SELECT row_number() OVER () AS n, id, price FROM products WHERE name LIKE 'Product %';

INSERT INTO orders (user_id, status, total_price, created_at, updated_at)
SELECT c.id,
       (ARRAY['pending','confirmed','shipped','delivered','cancelled'])[1 + (o % 5)]::orders_status_enum,
       0,
       t, t
FROM generate_series(1, 300000) AS o
JOIN seed_customers c ON c.n = 1 + (o % 2000)
CROSS JOIN LATERAL (SELECT now() - random() * interval '365 days' AS t) AS d;

-- 1 to 3 items per order (about 600,000 rows).
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT o.id, p.id, 1 + (random() * 4)::int, p.price
FROM orders o
CROSS JOIN LATERAL generate_series(1, 1 + (abs(hashtext(o.id::text)) % 3)) AS i
JOIN seed_products p ON p.n = 1 + (abs(hashtext(o.id::text || i)) % 10000)
WHERE o.total_price = 0;

UPDATE orders o SET total_price = s.total
FROM (SELECT order_id, sum(quantity * unit_price) AS total FROM order_items GROUP BY order_id) s
WHERE s.order_id = o.id AND o.total_price = 0;

-- One notification per order.
INSERT INTO notifications (user_id, message, created_at)
SELECT user_id, 'Order ' || id || ' was created', created_at FROM orders;

COMMIT;

ANALYZE;

SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM products) AS products,
       (SELECT count(*) FROM orders) AS orders,
       (SELECT count(*) FROM order_items) AS order_items,
       (SELECT count(*) FROM notifications) AS notifications;
