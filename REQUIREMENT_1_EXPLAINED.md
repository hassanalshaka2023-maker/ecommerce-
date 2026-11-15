# شرح المتطلب الأول — API Design & Security

هالملف بيشرح كل ملف بالمشروع: شو بيعمل، وليش انكتب هيك. الهدف إنكن تقدروا تشرحوا أي جزء بالمقابلة، لأنو أي عضو ممكن ينسأل عن أي جزء.

---

## 1. الصورة الكبيرة

تطبيق NestJS واحد مقسوم لأربع وحدات، متل ما طلب المتطلب:

```
backend/src/
  main.ts           ← نقطة التشغيل
  app.setup.ts      ← إعدادات عامة: أمان، /api/v1، تحقق، أخطاء، Swagger
  app.module.ts     ← قاعدة البيانات + JWT + الوحدات الأربع
  common/
    auth.ts                   ← كل منطق الدخول والصلاحيات
    all-exceptions.filter.ts  ← شكل موحّد لكل الأخطاء
  users/          ← التسجيل والدخول والأدوار
  products/       ← المنتجات وصورها
  orders/         ← الطلبات
  notifications/  ← إشعارات المستخدم
```

كل وحدة فيها نفس الخمس ملفات:

| الملف | شو فيه |
|---|---|
| `*.entity.ts` | شكل الجدول بقاعدة البيانات |
| `*.dto.ts` | شكل البيانات الداخلة، مع قواعد التحقق |
| `*.service.ts` | المنطق: قاعدة البيانات، الحسابات، القرارات |
| `*.controller.ts` | الروابط (routes): بيستقبل الطلب وبيسلّمه للـ service |
| `*.module.ts` | بيربط القطع ببعض |

**أهم قاعدة بالبنية:** كل وحدة بتملك جداولها، وما في وحدة بتقرأ جدول وحدة تانية مباشرة. إذا الطلبات بدها أسعار المنتجات، بتسأل `ProductsService.getForOrder()`، وما بتفتح جدول `products` بنفسها. هالنقطة مذكورة بملاحظات العرض، والمتطلب التاني مبني عليها.

---

## 2. رحلة أي طلب جوّا التطبيق

لما يوصل طلب HTTP، بيمر بهالترتيب:

```
الطلب
 → helmet          ترويسات أمان
 → /api/v1/...     المسار والإصدار
 → AuthGuard       مين أنت؟ (401)  ومسموحلك؟ (403)
 → ValidationPipe  البيانات صحيحة؟ (422)
 → Controller      أي دالة؟
 → Service         المنطق + قاعدة البيانات
 → الرد
 ↘ إذا صار أي خطأ بأي مرحلة → AllExceptionsFilter → رد بشكل موحّد
```

إذا حفظتوا هالرسمة، بتقدروا تجاوبوا على معظم أسئلة "شو بيصير لما...".

---

## 3. نقطة البداية: `main.ts` و `app.setup.ts`

`main.ts` تلت أسطر: بيبني التطبيق، بيطبّق الإعدادات، وبيشغّله على البورت 3000.

كل الإعدادات بدالة وحدة `setupApp()` بـ `app.setup.ts`. ليش دالة منفصلة؟ لأنو الاختبارات بتستعمل نفس الدالة، فبتفحص نفس إعدادات التشغيل الحقيقي بالضبط.

```ts
app.use(helmet());                                                       // ترويسات أمان
app.setGlobalPrefix('api');                                              // كل الروابط تبدأ بـ /api
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // → /api/v1
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,              // بيشيل أي حقل مو معرّف بالـ DTO
    forbidNonWhitelisted: true,   // وبيرفض الطلب إذا فيه حقل زيادة
    transform: true,              // بيحوّل الـ JSON لكائن DTO (و "2" لرقم 2)
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY, // أخطاء التحقق = 422
  }),
);
app.useGlobalFilters(new AllExceptionsFilter());        // شكل موحّد للأخطاء
app.useStaticAssets('uploads', { prefix: '/uploads' }); // بيعرض صور المنتجات
// + Swagger على /api/docs
```

نقاط ممكن تنسألوا عنها:
- **helmet** بيضيف ترويسات متل `X-Content-Type-Options: nosniff` و `Content-Security-Policy`، وبيشيل `X-Powered-By` (ما منفضح إنو السيرفر Express). هي "ترويسات الأمان الأساسية" يلي طالبها المتطلب.
- **`forbidNonWhitelisted`**: إذا زبون بعت `"role": "admin"` مع التسجيل ليرفّع حاله، الطلب بينرفض بـ 422.
- **ليش 422 مو 400؟** 422 معناها "فهمت طلبك، بس البيانات ما بتنفع"، وهي بالضبط حالة فشل التحقق. ملاحظات العرض ذكرت 422 بالاسم.

---

## 4. الأمان: `common/auth.ts`

هالملف هو كل نظام الدخول والصلاحيات، وفيه 4 أشياء.

### 4.1 الأدوار
```ts
export enum Role { CUSTOMER = 'customer', ADMIN = 'admin' }
```

### 4.2 `AuthGuard` (الحارس)
بيشتغل قبل الـ controller، وبيعمل فحصين ورا بعض:

```ts
const token = request.headers.authorization?.replace(/^Bearer /, '');
if (!token) throw new UnauthorizedException('Missing token');                 // 401

try {
  const { sub, role } = this.jwt.verify(token);   // التوقيع صحيح والتوكن مو منتهي؟
  request.user = { id: sub, role };
} catch {
  throw new UnauthorizedException('Invalid or expired token');                // 401
}

const roles = this.reflector.getAllAndOverride<Role[]>('roles', [...]);
if (roles.length && !roles.includes(request.user.role)) {
  throw new ForbiddenException('You are not allowed to do this');            // 403
}
```

- **401 = "مين أنت؟"**: ما في توكن، أو التوكن مزوّر، أو منتهي.
- **403 = "عرفناك، بس ممنوع"**: التوكن صحيح، بس دورك ما بيسمح.
- `jwt.verify` بيتأكد من التوقيع بالـ `JWT_SECRET`. إذا حدا غيّر حرف واحد بالتوكن (مثلاً حاول يغيّر `role` لـ admin)، التوقيع بيخرب والطلب بينرفض.

### 4.3 `@Auth()` (الاختصار)
```ts
export const Auth = (...roles: Role[]) =>
  applyDecorators(SetMetadata('roles', roles), UseGuards(AuthGuard), ApiBearerAuth());
```
بيجمع 3 أشياء بسطر واحد فوق أي route:
- `@Auth()`: أي مستخدم مسجّل دخول.
- `@Auth(Role.ADMIN)`: الأدمن بس.
- `ApiBearerAuth()`: بيخلي Swagger يبعت التوكن.

هيك بمجرد ما تفتحوا أي controller، بتعرفوا مين مسموحله يستعمل كل route.

### 4.4 `@CurrentUser()`
بيرجّع `request.user` يلي حطّه الحارس، يعني `{ id, role }` تبع صاحب التوكن. هيك الـ controller بياخد هوية المستخدم من التوكن الموقّع، مو من الـ body. ما منصدّق شي بيبعته المستخدم عن هويته.

---

## 5. وحدة Users

### الجدول (`user.entity.ts`)
`id` (uuid)، `name`، `email` (unique)، `password_hash`، `role` (افتراضياً `customer`)، `created_at`.

### التسجيل والدخول (`users.service.ts`)
```ts
async register({ name, email, password }: RegisterDto) {
  if (await this.users.existsBy({ email })) {
    throw new ConflictException('Email is already registered');            // 409
  }
  const passwordHash = await bcrypt.hash(password, 10);
  return this.issueToken(await this.users.save({ name, email, passwordHash }));
}

async login({ email, password }: LoginDto) {
  const user = await this.users.findOneBy({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new UnauthorizedException('Invalid email or password');           // 401
  }
  return this.issueToken(user);
}
```

- **bcrypt**: ما منخزّن كلمة السر أبداً، بس الـ hash تبعها. bcrypt بطيء عن قصد (2^10 دورة)، فلو انسرقت قاعدة البيانات، تخمين كلمات السر بياخد وقت كتير. وكل hash إله salt عشوائي، فكلمتين سر متطابقتين بيطلعلهن hash مختلف.
- **نفس رسالة الخطأ** للإيميل الغلط ولكلمة السر الغلط: لو فرّقنا بيناتهن، المهاجم بيعرف أي إيميلات مسجّلة (user enumeration).
- **التوكن** فيه `sub` (رقم المستخدم) و `role`، وبيخلص بعد ساعة.
- `RegisterDto` بيحدد طول كلمة السر بين 8 و 72، لأنو bcrypt بيتجاهل أي شي بعد 72 بايت.

### الأدمن الأول (`onModuleInit`)
وقت التشغيل، إذا `ADMIN_EMAIL` و `ADMIN_PASSWORD` موجودين بالبيئة وما في مستخدم بهالإيميل، بينعمل أدمن. ما في ولا endpoint بيعمل أدمن، فما في طريقة يرفّع فيها زبون حاله.

### تحديد محاولات الدخول
```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])   // بـ users.module.ts
@UseGuards(ThrottlerGuard)                              // فوق login بس، بـ users.controller.ts
```
5 محاولات بالدقيقة لكل IP، والسادسة بترجع 429. حطيناه على الـ login بس، مو على كل التطبيق: اختبار المتطلب التاني بيبعت طلبات كتير بنفس اللحظة، وحد عام على كل التطبيق ممكن يرفضها بـ 429 بدل ما يفحص الـ race condition فعلاً.

---

## 6. وحدة Products

### إضافة منتج مع صورة (`products.controller.ts`)
```ts
@Post()
@Auth(Role.ADMIN)
@ApiConsumes('multipart/form-data')
@UseInterceptors(imageUpload)
create(@Body() dto: CreateProductDto, @UploadedFile() image?: Express.Multer.File) { ... }
```
و `imageUpload` معرّف بأول الملف:
- **اسم عشوائي** (`randomUUID()`): ما منستعمل اسم الملف تبع المستخدم أبداً، فما في path traversal، وما حدا بيقدر يكتب فوق صورة موجودة.
- **حد أقصى 5MB**، و **JPEG/PNG/WEBP بس** (غير هيك → 422).
- الحارس (`@Auth`) بيشتغل **قبل** الـ interceptor، فالزبون أو الزائر ما بيقدر حتى يرفع ملف على السيرفر.

السعر بالـ DTO لازم يكون متل `49.99`: رقم موجب بخانتين عشريتين بالأكتر. وبقاعدة البيانات `decimal(10,2)` مو float، لأنو الـ float بيغلط بحسابات المصاري (0.1 + 0.2 ≠ 0.3).

### العرض والتصفية والصفحات (`products.service.ts`)
```ts
async findAll({ category, page = 1, limit = 10 }: QueryProductsDto) {
  const [items, total] = await this.products.findAndCount({
    where: category ? { category } : {},
    order: { createdAt: 'DESC' },
    skip: (page - 1) * limit,
    take: limit,
  });
  return { items, total, page, limit };
}
```
- `skip` و `take` هني الصفحات. `limit` أكبر شي 50 (بالـ DTO)، حتى ما حدا يطلب مليون منتج دفعة وحدة.
- على عمود `category` في index، فالتصفية سريعة.

### خدمة لباقي الوحدات: `getForOrder()`
```ts
async getForOrder(ids: string[]): Promise<Record<string, { name: string; price: string }>> {
  const products = await this.products.findBy({ id: In(ids) });
  if (products.length !== ids.length) {
    throw new UnprocessableEntityException('Some products do not exist');   // 422
  }
  return Object.fromEntries(products.map((p) => [p.id, { name: p.name, price: p.price }]));
}
```
(كان اسمها `getPrices()` وبترجع السعر بس. بالمتطلب الرابع صارت ترجع الاسم كمان، لأنو بريد التأكيد بيذكر اسم المنتج.)

هي الطريقة الوحيدة يلي فيها وحدة الطلبات بتوصل لبيانات المنتجات. استعلام واحد لكل منتجات الطلب، مو استعلام لكل منتج.

---

## 7. وحدة Orders

### إنشاء طلب (`orders.service.ts`)
```ts
const products = await this.products.getForOrder(items.map((i) => i.productId));
const lines = items.map(({ productId, quantity }) => ({
  productId,
  quantity,
  unitPrice: products[productId].price,
}));
const total = lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity, 0);
const order = await this.orders.save({ userId, totalPrice: total.toFixed(2), items: lines });
```
- **السعر والمجموع بينحسبوا على السيرفر.** ما منقبل سعر من المستخدم أبداً.
- **`unitPrice` بينحفظ مع كل سطر**: إذا تغيّر سعر المنتج بعدين، الطلبات القديمة ما بتتأثر.
- `userId` جاي من التوكن (`@CurrentUser()`)، مو من الـ body، فما حدا بيقدر يعمل طلب باسم غيره.
- `save` مع `cascade` بيحفظ الطلب وأسطره بـ transaction وحدة.
- الـ DTO بيرفض بـ 422: طلب فاضي، كمية أقل من 1، أو نفس المنتج مرتين (`@ArrayUnique`).

### ⭐ القاعدة الأساسية: كل زبون بيشوف طلباته بس
```ts
async findOne(id: string, user: AuthUser) {
  const order = await this.orders.findOneBy({ id });
  if (!order) throw new NotFoundException('Order not found');                    // 404
  if (order.userId !== user.id && user.role !== Role.ADMIN) {
    throw new ForbiddenException('This order belongs to another user');          // 403
  }
  return order;
}
```
**ليش هالفحص بالـ service مو بالحارس؟** الحارس بيعرف مين أنت وشو دورك، بس ما بيعرف الطلب لمين. لازم نجيب الطلب من قاعدة البيانات لنقارن `order.userId` مع رقمك. هالثغرة (تغيّر رقم بالرابط وتشوف بيانات غيرك) اسمها **IDOR**، وهي من أشهر ثغرات الـ APIs.

### تغيير الحالة: للأدمن بس
```ts
@Patch(':id/status')
@Auth(Role.ADMIN)
```
الحالات: `pending` (الافتراضية)، `confirmed`، `shipped`، `delivered`، `cancelled`. أي قيمة تانية → 422. وبعد كل تغيير، بيوصل إشعار لصاحب الطلب.

### القائمة
`GET /orders`: الزبون بيشوف طلباته بس، والأدمن بيشوف الكل:
```ts
where: user.role === Role.ADMIN ? {} : { userId: user.id }
```

---

## 8. وحدة Notifications

جدول بسيط: `user_id`، `message`، `created_at`. `OrdersService` بينادي `notifications.notify()` لما ينعمل طلب أو تتغيّر حالته. و `GET /notifications` بيرجّع إشعاراتك إنت بس، من الأحدث للأقدم.

---

## 9. الأخطاء: `all-exceptions.filter.ts`

`@Catch()` بدون شي بين القوسين يعني بيمسك **كل** الأخطاء. أي خطأ، من أي مكان، بيطلع بنفس الشكل:

```json
{
  "statusCode": 403,
  "error": "FORBIDDEN",
  "message": "This order belongs to another user",
  "path": "/api/v1/orders/...",
  "timestamp": "2026-11-03T18:00:00.000Z"
}
```

إذا كان الخطأ غير متوقع (bug)، بيرجع 500 برسالة عامة، والتفاصيل بتنكتب باللوغ بس. ما منفرجي المستخدم تفاصيل داخلية.

### جدول رموز الحالة
| الرمز | إيمتى | مثال |
|---|---|---|
| 200 | نجاح | دخول، عرض |
| 201 | انعمل شي جديد | تسجيل، منتج، طلب |
| 400 | الرابط نفسه مشوّه | `/orders/abc` (مو uuid) |
| 401 | ما عرفنا مين أنت | بلا توكن، أو توكن مزوّر أو منتهي |
| 403 | عرفناك بس ممنوع | زبون بيفتح طلب غيره |
| 404 | مو موجود | طلب أو منتج مو موجود |
| 409 | تعارض | إيميل مسجّل من قبل |
| 422 | البيانات غلط | إيميل غلط، سعر سالب، منتج مو موجود |
| 429 | محاولات كتير | محاولة الدخول السادسة بالدقيقة |
| 500 | خطأ من عنّا | bug |

---

## 10. قاعدة البيانات

| الجدول | الأعمدة |
|---|---|
| `users` | `id`, `name`, `email` (unique), `password_hash`, `role`, `created_at` |
| `products` | `id`, `name`, `description`, `price`, `category` (index), `image_url`, `created_at` |
| `orders` | `id`, `user_id`, `status`, `total_price`, `created_at`, `updated_at` |
| `order_items` | `id`, `order_id` (FK → orders), `product_id`, `quantity`, `unit_price` |
| `notifications` | `id`, `user_id`, `message`, `created_at` |

ما في foreign key بين جداول وحدات مختلفة (مثلاً `orders.user_id` ما بيأشّر على `users`). الـ FK الوحيد هو `order_items → orders`، لأنهن بنفس الوحدة. هيك كل وحدة مستقلة، ولو انفصلت بعدين لخدمة لحالها (متل المستودع بالمتطلب التاني) ما بينكسر شي.

الجداول بتنعمل لحالها من الـ entities (`synchronize: true`)، لأنو المشروع ما فيه migrations.

---

## 11. Docker

```bash
docker compose up --build
```

- **`db`**: PostgreSQL 16، مفتوحة على البورت 5433 بالجهاز (مو 5432)، حتى ما تتضارب مع Postgres منزّل على الجهاز.
- **`api`**: التطبيق. ما بيبلّش إلا لما `db` تصير **healthy** (`depends_on` + `healthcheck`)، مو بس لما الحاوية تشتغل، لأنو Postgres بياخد كم ثانية ليصير جاهز يستقبل اتصالات.
- **volumes**: البيانات والصور بتضل محفوظة حتى لو وقّفتوا الحاويات.
- **`Dockerfile` بمرحلتين**: الأولى بتبني الكود، والتانية بتاخد الناتج بس مع مكتبات التشغيل (بدون أدوات التطوير)، فالصورة أصغر وأأمن.

---

## 12. الاختبارات

```bash
docker compose up -d db warehouse-db warehouse
cd backend
npm run test:e2e
```

19 اختبار (من أصل 24 مع المتطلب التاني) على قاعدة بيانات حقيقية، مقسومين حسب نقاط المتطلب. أهمهن اختبار **PROOF**:
- زبون بيحاول يفتح طلب غيره → 403
- بدون توكن → 401، وبتوكن مزوّر → 401
- زبون بيحاول يغيّر الحالة → 403، والأدمن بيقدر → 200

---

## 13. شو تغيّر بهالنسخة وليش

| قبل | هلق | ليش |
|---|---|---|
| وحدة الطلبات بتقرأ جدول المنتجات مباشرة | بتسأل `ProductsService.getForOrder()` | ملاحظات العرض: "لا تقرأ وحدة جداول وحدة أخرى مباشرة" |
| أخطاء التحقق بترجع 400 | بترجع 422 | ملاحظات العرض ذكرت 422 بالاسم |
| Passport + JwtStrategy + JwtAuthGuard + RolesGuard + Roles | حارس واحد `AuthGuard` + `@Auth()` | نفس الأمان بكود أقل وأوضح |
| حد عام 60 طلب بالدقيقة + 5 للدخول | 5 للدخول بس | الحد العام ممكن يخرّب اختبار الـ race condition بالمتطلب التاني |
| الأدمن بـ SQL يدوي | بينعمل لحاله وقت التشغيل | العرض بالمقابلة أسهل، وبرضو ما في endpoint |
| 38 ملف | 24 ملف | كل وحدة بنفس الخمس ملفات |

---

## 14. أسئلة متوقعة بالمقابلة

**شو الفرق بين 401 و 403؟**
401 يعني ما عرفنا مين أنت (بلا توكن أو توكن غلط). 403 يعني عرفناك بس ما إلك صلاحية.

**كيف بتمنعوا زبون يشوف طلب غيره؟**
بـ `findOne`: منجيب الطلب ومنقارن `order.userId` مع الرقم يلي بالتوكن. إذا مختلفين والمستخدم مو أدمن → 403. والرقم جاي من توكن موقّع، فما حدا بيقدر يزوّره.

**شو بيصير إذا حدا عدّل الـ role جوّا التوكن؟**
التوقيع بيخرب، فـ `jwt.verify` بيفشل → 401.

**إذا غيّرنا دور مستخدم بقاعدة البيانات، بيتغيّر فوراً؟**
لا. الدور محفوظ جوّا التوكن، فبيتغيّر بس لما ياخد توكن جديد (login من جديد)، أو لما يخلص التوكن القديم بعد ساعة.

**ليش ما في foreign key بين `orders` و `users`؟**
لأنو كل وحدة بتملك جداولها، والـ FK بيربط وحدتين ببعض على مستوى قاعدة البيانات. وصحة `user_id` مضمونة لأنو جاي من توكن موقّع.

**ليش 422 مش 400؟**
400 للطلب المشوّه (مثلاً رابط فيه id مو uuid). 422 لطلب مفهوم بس بياناته ما بتنفع: إيميل غلط، كمية 0، منتج مو موجود.

**ليش bcrypt مو SHA-256؟**
SHA-256 سريع، فالمهاجم بيجرّب مليارات كلمات السر بالثانية. bcrypt بطيء عن قصد، وفيه salt.

**ليش اسم الصورة عشوائي؟**
حتى ما حدا يرفع ملف باسم متل `../../main.js` (path traversal)، أو يكتب فوق صورة موجودة.

**إذا تغيّر سعر منتج، شو بيصير بالطلبات القديمة؟**
ما بيتغيّر شي، لأنو `unit_price` و `total_price` انحفظوا وقت الطلب.

**`synchronize: true` آمن بالإنتاج؟**
لا. هو مناسب للتطوير لأنو بيعمل الجداول من الـ entities لحالها، بس ممكن يحذف أعمدة إذا تغيّرت الـ entities. بالإنتاج منستعمل migrations.
