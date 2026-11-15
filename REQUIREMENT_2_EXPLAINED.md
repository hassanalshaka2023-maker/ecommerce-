# شرح المتطلب التاني — Inter-Service Communication

هالملف بيشرح خدمة المستودع وكيف بيحكي معها الـ API: شو بيعمل كل ملف، وليش انكتب هيك. أي عضو ممكن ينسأل عن أي جزء، فاقروه كلكن.

---

## 1. الصورة الكبيرة

```
┌──────────────┐   gRPC (proto/warehouse.proto)   ┌──────────────────┐
│  NestJS API  │ ───────────────────────────────▶ │ Warehouse (Python)│
│  (TypeScript)│ ◀─────────────────────────────── │   :50051          │
└──────┬───────┘                                  └────────┬─────────┘
       │                                                   │
  ┌────▼─────┐                                       ┌─────▼──────┐
  │ ecommerce│  منتجات، طلبات، مستخدمين               │ warehouse  │  مخزون، حجوزات
  │  :5433   │                                       │   :5434    │
  └──────────┘                                       └────────────┘
```

| شو طلب المتطلب | كيف عملناه |
|---|---|
| خدمة بلغة **تانية** | المستودع مكتوب بـ **Python**، والـ API بـ TypeScript |
| إلها قاعدة بيانات **لحالها** | `warehouse-db` على بورت 5434. الـ API ما بيعرف عنوانها أصلاً |
| التواصل بـ **gRPC** | ملف عقد واحد `proto/warehouse.proto`، والطرفين بيبنوا عليه |
| الحجز بنداء واحد، **كل شي أو ولا شي** | `ReserveStock` بياخد كل المنتجات، وبينفذ بـ transaction واحدة |
| الطلب ما بينحفظ إلا بعد موافقة المستودع | `OrdersService.create`: حجز ← حفظ |
| معالجة الأعطال الثلاثة | 409 للمخزون الناقص، 503/504 للمستودع الواقف أو البطيء، و`release` إذا فشل الحفظ |
| إثبات السباق | اختبار `PROOF`: 20 طلب على آخر قطعة، وواحد بس بينجح |

الملفات الجديدة:
```
proto/warehouse.proto          ← العقد
warehouse/
  server.py                    ← خدمة المستودع
  requirements.txt             ← مكتبات بايثون
  Dockerfile                   ← بيولّد كود gRPC من العقد وبيشغّل السيرفر
  try_warehouse.py             ← تجربة يدوية للخدمة لحالها
backend/src/warehouse/
  warehouse.service.ts         ← عميل gRPC بالـ API
  warehouse.module.ts
backend/test/requirement2.e2e-spec.ts
frontend/                      ← واجهة للمتطلبين
```

---

## 2. العقد: `proto/warehouse.proto`

```proto
service Warehouse {
  rpc GetStock (ProductId) returns (Stock);
  rpc SetStock (Stock) returns (Stock);
  rpc ReserveStock (Reservation) returns (Empty);
  rpc ReleaseStock (OrderId) returns (Empty);
}
```

- هاد الملف هو **الاتفاق** بين الخدمتين: شو الدوال، وشو بياخدوا وشو بيرجعوا.
- بايثون بتولّد منه `warehouse_pb2.py` و`warehouse_pb2_grpc.py` (بالـ Dockerfile بأمر `grpc_tools.protoc`). هالملفات مولّدة، فما منحطها بـ git.
- الـ API بيقرأه وقت التشغيل بـ `@grpc/proto-loader`.
- إذا تغيّر العقد، الطرفين بيتغيّروا مع بعض لأنو الاتنين بيقروا من نفس الملف. بالـ Docker، منمرّر مجلد `proto` للخدمتين بـ `additional_contexts`.
- **`Reservation`** فيها `order_id` و**قائمة** `items`. هيك الحجز بيصير بنداء واحد لكل الطلب.

---

## 3. خدمة المستودع: `warehouse/server.py`

### الجداول
```sql
stock(product_id uuid PRIMARY KEY, quantity integer NOT NULL CHECK (quantity >= 0))
reservations(order_id, product_id, quantity, PRIMARY KEY (order_id, product_id))
```
- `CHECK (quantity >= 0)`: حماية أخيرة، فقاعدة البيانات نفسها بترفض أي مخزون سالب.
- `reservations` بتسجّل شو انحجز لكل طلب، حتى نقدر نرجّعه بالضبط.
- الجداول بتنعمل لحالها أول ما يشتغل السيرفر (`CREATE TABLE IF NOT EXISTS`).

### `pool = ConnectionPool(...)`
مجموعة اتصالات جاهزة بقاعدة البيانات. السيرفر بيخدم 10 طلبات بنفس الوقت (`ThreadPoolExecutor(max_workers=10)`)، وكل طلب بياخد اتصال من المجموعة.

`with pool.connection() as conn:` بتفتح **transaction**: إذا خلص البلوك بدون خطأ بيصير commit، وإذا طلع خطأ بيصير rollback لكل شي.

### `GetStock` و `SetStock`
- `GetStock`: بيقرأ الكمية. إذا المنتج مش موجود بجدول المخزون، بيرجّع 0.
- `SetStock`: إذا الكمية سالبة بيرفض بـ `INVALID_ARGUMENT`. غير هيك بيعمل **upsert**: `INSERT ... ON CONFLICT DO UPDATE`، يعني بيضيف إذا جديد وبيعدّل إذا موجود.

### ⭐ `ReserveStock`: قلب المتطلب
```python
reserved = conn.execute(
    """UPDATE stock SET quantity = quantity - %s
       WHERE product_id = %s AND quantity >= %s""", ...
).rowcount
if reserved == 0:
    raise OutOfStock(item.product_id)
```

**ليش هاد بيحل مشكلة السباق؟**

الطريقة الغلط: `SELECT quantity` ← إذا كافي ← `UPDATE`. بين القراءة والتعديل، طلب تاني ممكن يقرأ نفس الكمية، فالتنين بيشوفوا "في قطعة" والتنين بيحجزوها.

الطريقة الصح، يلي عملناها: **الفحص والتنقيص بجملة وحدة**. PostgreSQL بيقفل السطر وقت الـ UPDATE، فإذا 20 طلب إجوا سوا:
1. الأول بياخد القفل، بيلاقي `quantity >= 1`، بينقّص، وبيصير المخزون 0.
2. الباقيين بيستنوا القفل. لما ياخدوه، الشرط `quantity >= 1` بيرجع يتفحص على القيمة الجديدة (0)، فما بيتعدّل شي و`rowcount = 0`.

**كل شي أو ولا شي:** إذا منتج من المنتجات ما كفى، منرمي `OutOfStock`، فبيطلع الخطأ من بلوك `with`، وبيصير rollback لكل المنتجات يلي انحجزت قبله بنفس الطلب. بعدين منرجّع `FAILED_PRECONDITION` مع رسالة واضحة.

**ليش `sorted(...)`؟** لو طلب بيحجز (A ثم B) وطلب تاني (B ثم A) بنفس اللحظة، كل واحد ممكن يمسك قفل ويستنى التاني للأبد (deadlock). لما الترتيب دايماً نفسه، ما بيصير هالشي.

### `ReleaseStock`: الإرجاع
```sql
WITH released AS (DELETE FROM reservations WHERE order_id = %s RETURNING product_id, quantity)
UPDATE stock SET quantity = stock.quantity + released.quantity FROM released WHERE ...
```
بيحذف حجوزات الطلب، وبيرجّع كمياتها للمخزون، بجملة وحدة.

**آمن لو انبعت مرتين (idempotent):** بالمرة التانية ما في حجوزات ليحذفها، فما بيرجّع شي. وهاد مهم بحالة الـ timeout (شوفوا القسم 5).

---

## 4. العميل بالـ API: `backend/src/warehouse/warehouse.service.ts`

- بيقرأ نفس ملف العقد، وبيعمل client على `WAREHOUSE_URL` (بالـ Docker: `warehouse:50051`).
- أربع دوال بسيطة: `getStock`، `setStock`، `reserve`، `release`. كلهن بيمرّوا من `call()`.

### `call()` والمهلة
```ts
const deadline = Date.now() + TIMEOUT_MS; // 2 ثانية
```
كل نداء إلو **مهلة**. إذا المستودع ما رد خلال ثانيتين، النداء بيفشل بدل ما يضل الطلب معلّق، والمستخدم بيستنى للأبد.

### `toHttpError()`: ترجمة أخطاء gRPC لـ HTTP
| gRPC | HTTP | يعني |
|---|---|---|
| `FAILED_PRECONDITION` | **409** Conflict | المخزون مش كافي |
| `INVALID_ARGUMENT` | **422** | كمية غلط |
| `DEADLINE_EXCEEDED` | **504** Gateway Timeout | المستودع ما رد بالوقت |
| أي شي تاني (مثلاً `UNAVAILABLE`) | **503** Service Unavailable | المستودع واقف |

---

## 5. ⭐ إنشاء الطلب: `orders.service.ts → create`

```
1. الأسعار من ProductsService.getForOrder()
2. orderId = randomUUID()
3. warehouse.reserve(orderId, items)
      ├─ مش كافي ← 409، وما في طلب
      ├─ واقف    ← 503، وما في طلب
      └─ timeout ← release احتياطاً، ثم 504
4. orders.save({ id: orderId, ... })
      └─ فشل ← release، ثم الخطأ
5. إشعار للزبون
```

**ليش منولّد رقم الطلب قبل الحفظ؟** المستودع بيسجّل الحجز على رقم الطلب، والطلب لسا ما انحفظ. فمنولّده نحنا، ومنستعمله بالمكانين. هيك منعرف شو نرجّع إذا احتجنا.

**الحالات الثلاث يلي طلبها المتطلب:**
1. **المخزون مش كافي** → المستودع بيرفض، والـ API بيرجّع 409 مع اسم المنتج، والطلب ما بينحفظ.
2. **المستودع واقف أو بطيء** → المهلة (ثانيتين) بتمنع التعليق، والمستخدم بياخد 503 أو 504 مع رسالة مفهومة.
3. **انحجز وفشل الحفظ** → `release(orderId)`، فالكمية بترجع.

**وحالة رابعة دقيقة:** إذا صار timeout، نحنا **ما منعرف** إذا المستودع حجز ورده تأخر، أو ما حجز أبداً. فمنبعت `release` احتياطاً، ولأنو الإرجاع آمن مرتين، ما في خطر بالحالتين.

**`.catch(() => {})` على الـ release:** إذا الإرجاع نفسه فشل، ما منخلّيه يغطّي على الخطأ الأصلي يلي لازم يشوفه المستخدم.

**ليش الإشعار برا الـ `try`؟** إذا فشل الإشعار، الطلب صار محفوظ، فما لازم نرجّع الكمية.

---

## 6. المنتجات

- **`GET /products/:id`** بيرجّع المنتج + `stock` من المستودع. إذا المستودع واقف، المنتج **بيضل يطلع** بس مع `stock: null` و`stockError`. صفحة منتج ما لازم توقع لأنو خدمة تانية وقعت (graceful degradation).
- **`PUT /products/:id/stock`** (للأدمن): بيتأكد إنو المنتج موجود عنا (404 إذا لأ)، وبعدين بيبعت الكمية للمستودع.
- الـ API **ما بيقرأ** جدول المستودع أبداً، كل شي عبر gRPC.

---

## 7. Docker

```yaml
warehouse-db:  postgres، بورت 5434، volume لحالو
warehouse:     build ./warehouse + proto، بيستنى warehouse-db يكون healthy
api:           WAREHOUSE_URL: warehouse:50051
```
`additional_contexts: proto: ./proto` بتخلّي الـ Dockerfile تبع كل خدمة يقدر ينسخ ملف العقد من برا مجلده (`COPY --from=proto ...`).

---

## 8. الاختبارات

```bash
docker compose up -d db warehouse-db warehouse
cd backend
npm run test:e2e
```
24 اختبار: 19 للمتطلب الأول + 5 للتاني:

| الاختبار | شو بيثبت |
|---|---|
| only an admin set stock | الحماية والتحقق على الـ endpoint الجديد |
| live stock on the product page | الـ API عم يحكي مع بايثون عبر gRPC |
| takes the ordered quantity out | الطلب بينقّص من المستودع |
| all or none | منتج كافي + منتج ناقص ← ولا واحد بينحجز، وما في طلب |
| ⭐ **PROOF: 20 customers race** | 20 طلب بنفس اللحظة على آخر قطعة ← واحد 201 و19 بـ 409، والمخزون 0 |

---

## 9. العرض قدام المعيد

1. **السباق:** `npm run test:e2e` وفرجوه اختبار PROOF. أو `python try_warehouse.py` من مجلد `warehouse` (بيطلع `reserved: 1 | rejected: 19`).
2. **المخزون الناقص:** من الواجهة، منتج مخزونه 2، اطلبوا 3 ← رسالة حمرا *Not enough stock*.
3. **توقيف المستودع:**
   ```bash
   docker compose stop warehouse
   ```
   - صفحة المنتج بتضل تشتغل، بس بدون مخزون.
   - الطلب بيفشل برسالة واضحة خلال ثانيتين، وما بينحفظ.
   ```bash
   docker compose start warehouse
   ```

---

## 10. أسئلة متوقعة بالمقابلة

**ليش gRPC مو REST بين الخدمتين؟**
عقد مكتوب (proto) بيولّد الكود للطرفين، فما في اختلاف بأسماء الحقول أو أنواعها. وهو أسرع لأنو binary على HTTP/2، وفيه deadlines جاهزة.

**ليش المستودع إلو قاعدة بيانات لحالو؟**
حتى يكون هو المالك الوحيد للمخزون. لو الـ API بيقرأ أو يكتب بجدول المخزون مباشرة، كان فيه يتجاوز قواعد الحجز ويرجع مشكلة السباق.

**شو بيصير إذا 20 زبون طلبوا آخر قطعة بنفس اللحظة؟**
كل الطلبات بتوصل لـ `UPDATE ... WHERE quantity >= 1`. PostgreSQL بيقفل السطر، فالأول بينقّص، والباقيين بيلاقوا الشرط ما عاد يتحقق (`rowcount = 0`) فبيترفضوا. والاختبار بيثبت هالشي.

**ليش ما استعملتوا `SELECT ... FOR UPDATE`؟**
كان بيشتغل كمان، بس بيحتاج جملتين وفحص بالكود. الـ UPDATE المشروط بيعمل القفل والفحص والتنقيص بجملة وحدة، وأبسط.

**شو بيصير إذا طلب فيه 3 منتجات، والتالت ناقص؟**
التنين الأولانيين بينحجزوا جوّا الـ transaction، وبعدين `OutOfStock` بيعمل rollback، فبيرجعوا. ما بينحجز ولا واحد، وما بينحفظ طلب.

**إذا المستودع حجز، وبعدين قاعدة بيانات الطلبات وقعت قبل الحفظ؟**
منلقط الخطأ ومنبعت `release(orderId)`، فالكمية بترجع.

**وإذا المستودع حجز بس رده وصل بعد المهلة؟**
ما منعرف إذا حجز أو لأ، فمنبعت `release` احتياطاً. الإرجاع idempotent: إذا ما في حجز، ما بيعمل شي.

**ليش 504 بدل 503 لما وقّفنا المستودع؟**
لما الحاوية بتوقف، gRPC بيضل يحاول يتصل لحد ما تخلص المهلة، فبيطلع `DEADLINE_EXCEEDED` (504). إذا الاتصال انرفض فوراً، بيطلع `UNAVAILABLE` (503). بالحالتين المستخدم بياخد رسالة واضحة بأقل من ثانيتين.

**كيف بتمنعوا deadlock بين طلبين؟**
منرتّب المنتجات بالـ id قبل الحجز، فكل الطلبات بتقفل الأسطر بنفس الترتيب.

**ليش ما في foreign key بين `stock.product_id` وجدول المنتجات؟**
لأنهن بقاعدتين مختلفتين، وبخدمتين مختلفتين. الـ API بيتأكد إنو المنتج موجود قبل ما يبعت `SetStock`.
