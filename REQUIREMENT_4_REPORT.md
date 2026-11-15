# تقرير المتطلب الرابع — Asynchronous Queues & Real-Time

الهدف حسب المتطلب: **يلي ما بيحتاج المستخدم يستناه بيصير بالخلفية، ويلي بيهمّه بيوصل لشاشته فوراً.**

| المطلوب | شو عملنا | الإثبات |
|---|---|---|
| نشر حدث بـ RabbitMQ عند إنشاء الطلب، والتطبيق ما بيستنى | حدث `order.created` بـ exchange اسمو `orders.events`. الطلب بيرجع **201 بأقل من 0.1 ثانية** | قسم 3 |
| عامل مستقل بيرسل بريد تأكيد عبر خدمة بريد خارجية | برنامج لحالو (`worker`) بحاوية لحالها، بيرسل عبر SMTP | قسم 4 |
| الرسالة ما بتضيع إذا تعطّل العامل، مع إعادة محاولة و DLQ | ack بعد الإرسال بس، طوابير durable، إعادة محاولة بعد 5 ثواني، و`emails.dlq` بعد 3 محاولات | قسم 5 |
| صفحة متابعة الطلب: الزبون بيشوف الحالة بتتغيّر لحظياً، وما حدا غيرو بيقدر يتابعها | صفحة **Track live** + قناة `order:<id>` | قسم 6 |
| لوحة الأدمن: الطلب الجديد بيظهر فوراً، وللأدمن بس | صفحة **Live dashboard** + قناة `admin` | قسم 6 |
| التحقق من الهوية والصلاحية قبل الاشتراك بأي قناة | التوكن عند الاتصال، والدور أو الملكية عند الاشتراك | قسم 7 |

كل التجارب بهالتقرير معمولة على النظام الحقيقي الشغّال (Docker)، والصور بمجلد [requirement4-images/](requirement4-images/).

---

## 1. الصورة الكبيرة

```
الزبون: POST /orders
   │
   ▼
API ── transaction واحدة ──▶ جدول orders  +  صف بجدول outbox_events ("order.created")
   │                                     │
   ▼                                     ▼ المرحّل (فوراً، وكل ثانية احتياطاً)
201 فوراً                         RabbitMQ: exchange "orders.events"
                                 ┌───────────┴─────────────┐
                          طابور "emails"          طابور مؤقت لكل نسخة API
                                 │                        │
                         العامل (Worker)           Socket.IO
                  بيرسل البريد، وبعدين ack      قناة "admin" · قناة "order:<id>"
         فشل؟ ─▶ "emails.retry" (5 ثواني) ─▶ يرجع للطابور
         بعد 3 محاولات ─▶ "emails.dlq"
```

| الخدمة | شو بتعمل | العنوان |
|---|---|---|
| `rabbitmq` | الوسيط: exchange وطوابير | صفحة الإدارة `http://localhost:15672` (guest / guest) |
| `worker` | العامل: بيقرا طابور `emails` وبيرسل البريد | (ما إلو بورت) |
| `mailpit` | بيلقط كل بريد بيرسلو العامل وبيعرضو بصفحة (للتطوير) | `http://localhost:8025` |
| `api` | بينشر الأحداث، وبيدفعها للشاشات | `http://localhost:3001` |

---

## 2. ليش جدول outbox وما منبعت لـ RabbitMQ مباشرة؟

**المشكلة:** لو الكود بيحفظ الطلب، وبعدين بيبعت الحدث لـ RabbitMQ، فإذا RabbitMQ كان واقف بهاللحظة (أو الـ API وقع بين الخطوتين)، الطلب بينحفظ **والحدث بيضيع**، والزبون ما بيوصلو بريد أبداً.

**الحل (Transactional Outbox):** الحدث بينحفظ كصف بجدول `outbox_events` **بنفس الـ transaction** تبع الطلب. يعني إما الاتنين بينحفظوا أو ولا واحد. بعدين **المرحّل** (`EventsService.flush`) بيبعت الصفوف يلي ما انبعتت، وبيعلّمها "انبعتت" **بس بعد ما RabbitMQ يأكّد استلامها** (publisher confirms).

- المرحّل بيشتغل **فوراً** بعد كل طلب، و**كل ثانية** كشبكة أمان.
- `FOR UPDATE SKIP LOCKED`: إذا في أكتر من نسخة API (المتطلب الخامس)، ما بيبعتوا نفس الحدث مرتين.
- الصفوف المنبعتة بتنمسح بعد يوم.

**جرّبناها:** وقّفنا RabbitMQ وعملنا طلب:
```
RabbitMQ STOPPED
  order -> 201 in 0.028s
  waiting in the outbox (database): 1
RabbitMQ STARTED
  after ~10s: outbox pending = 0, and the email arrived
```

---

## 3. نشر الحدث: التطبيق ما بيستنى

الكود بـ [orders.service.ts](backend/src/orders/orders.service.ts):
```ts
order = await this.orders.manager.transaction(async (tx) => {
  const saved = await tx.save(Order, { id: orderId, userId, totalPrice, items: lines });
  await this.events.record(tx, 'order.created', { order: {...}, customer });
  return saved;
});
void this.events.flush(); // بيبعت الحدث الآن، بدون ما الزبون يستنى
```
- الطلب بيرجع **201 بـ 0.03 لـ 0.08 ثانية** بقياسنا، وما في أي بريد بينبعت جوّا الطلب.
- بيانات البريد (اسم الزبون وإيميلو) بتجي من `UsersService.contactOf()`، وأسماء المنتجات من `ProductsService.getForOrder()`. يعني الطلبات **ما بتقرا جداول وحدات تانية** (قاعدة المتطلب الأول).
- تغيير حالة الطلب (`PATCH /orders/:id/status`) بيعمل نفس الشي مع حدث `order.status_changed`.

---

## 4. العامل (Worker)

- **برنامج مستقل:** [backend/src/worker/main.ts](backend/src/worker/main.ts). نفس صورة Docker تبع الـ API، بس بأمر تشغيل مختلف (`node dist/worker/main.js`) وبحاوية لحالها. ما بيعرف شي عن قاعدة البيانات، بيعرف الطابور بس.
- **بيرسل عبر SMTP**، يعني بيشتغل مع أي خدمة بريد خارجية (Gmail، Brevo، وغيرهن). الإعدادات بملف `.env` (شوفوا قسم 9).
- **وحدة وحدة** (`prefetch(1)`)، و**مهلة** 10-15 ثانية لخادم البريد، حتى خادم واقف ما يعلّق العامل للأبد.

![البريد](requirement4-images/08-mailpit-confirmation-email.png)

---

## 5. ⭐ ليش ما بيضيع أي بريد

| الخطر | الحماية |
|---|---|
| RabbitMQ واقف وقت الطلب | الحدث بيستنى بالـ outbox وبينبعت لما يرجع (قسم 2) |
| RabbitMQ نفسو بيعيد التشغيل | الطوابير `durable` والرسائل `persistent`، فبينحفظوا على القرص (volume `rabbit_data`) |
| العامل واقف | الرسائل بتستنى بالطابور |
| العامل وقع **بنص** إرسال البريد | الـ **ack بعد الإرسال بس**. رسالة بدون ack بترجع للطابور لحالها لما ينقطع اتصال العامل |
| خادم البريد واقف مؤقتاً | **إعادة محاولة:** الرسالة بتروح لـ `emails.retry`، بتستنى 5 ثواني (TTL)، وبترجع لـ `emails` لحالها (dead-letter routing) |
| البريد بيفشل دايماً | بعد **3 محاولات** بتروح لـ **`emails.dlq`** مع عدد المحاولات وسبب الفشل، حتى حدا يشوفها |
| ما قدرنا ننقل الرسالة للـ retry أو الـ DLQ | `nack` مع requeue: بترجع للطابور، وما بتنحذف |

### الإثبات 1: إيقاف العامل وتشغيلو ما بيضيّع بريد
وقّفنا العامل (`docker compose -p ecommerce-local stop worker`)، وعملنا طلبين. الطابور `emails` صار فيه **2**:

![العامل واقف](requirement4-images/06-rabbitmq-worker-stopped.png)

شغّلنا العامل، والإيميلات وصلت كلها:

![بعد التشغيل](requirement4-images/07-mailpit-after-worker-restart.png)

والاختبار `PROOF: stopping the worker, even in the middle of an email, loses no email` أصعب من هيك: العامل بياخد البريد و**بيموت بنصّو قبل ما يرسلو**، وبعدين بيوصل طلبين والعامل واقف، وعامل جديد بيلاقي **التلاتة**.

### الإثبات 2: الـ DLQ
شغّلنا العامل على خادم بريد غلط عن قصد (`SMTP_HOST=no-such-mail-server`):
```
email failed (attempt 1/3) -> emails.retry: Error: getaddrinfo ENOTFOUND no-such-mail-server
email failed (attempt 2/3) -> emails.retry: ...
email failed (attempt 3/3) -> emails.dlq:   ...
DLQ message headers: {'x-attempts': 3, 'x-error': 'Error: getaddrinfo ENOTFOUND no-such-mail-server'}
```
والطلب نفسو رجع 201 عادي. البريد لحالو يلي فشل، والطلب ما تأثر.

---

## 6. ⭐ التحديثات اللحظية

**التقنية:** Socket.IO (WebSocket) على نفس بورت الـ API. Vite بيحوّل `/socket.io` للـ API.

**من وين بيجي الحدث؟** كل نسخة API عندها **طابور مؤقت لحالها** مربوط بكل أحداث `orders.events`. فكل نسخة بتسمع كل حدث وبتبعتو للشاشات المتصلة فيها. ورح نستفيد من هالشي لما يصير في أكتر من نسخة API (المتطلب الخامس).

| القناة | مين بيدخلها | شو بيوصلها |
|---|---|---|
| `admin` | الأدمن بس | كل طلب جديد (مع الزبون والمنتجات)، وكل تغيير حالة |
| `order:<id>` | صاحب الطلب (أو الأدمن) | تغيير حالة هالطلب |

### الإثبات 3: الطلب الجديد بيظهر فوراً بلوحة الأدمن
بالواجهة الحقيقية: الزبون ضغط **Place order**، وبعد **176-313 ms** ظهر الطلب بلوحة الأدمن، بدون أي تحديث للصفحة. الطلب الجديد بيظهر بالأعلى ومعلّم بالأخضر:

![لوحة الأدمن](requirement4-images/02-admin-dashboard-new-order.png)

### الإثبات 4: موافقة الأدمن بتظهر فوراً عند الزبون
الأدمن ضغط **Approve**، وصفحة الزبون تحدّثت لحالها بعد **105-172 ms**:

| قبل | بعد |
|---|---|
| ![قبل](requirement4-images/03-customer-tracking-pending.png) | ![بعد](requirement4-images/04-customer-tracking-confirmed.png) |

(من الـ API مباشرة بدون واجهة: 28 ms للطلب الجديد و21 ms للموافقة.)

**وإذا انقطع الاتصال؟** Socket.IO بيعيد الاتصال لحالو، والصفحة بتشترك من جديد، **وبتجيب الحالة الحالية**، حتى ما يضيع تغيير صار والاتصال مقطوع.

---

## 7. ⭐ الصلاحيات قبل الاشتراك

1. **عند الاتصال:** بدون توكن صالح، الاتصال بينرفض (`unauthorized`). والاتصال **بيسكّر لحالو لما ينتهي التوكن**، يعني توكن منتهي ما بيضل يسمع.
2. **عند الاشتراك بقناة `admin`:** الدور لازم يكون `admin`، وإلا `forbidden`.
3. **عند الاشتراك بقناة `order:<id>`:** نفس قاعدة `GET /orders/:id` بالضبط (`OrdersService.findOne`). الزبون صاحب الطلب أو الأدمن بس. وطلب مش موجود أو رقم غلط بيرجع `forbidden` كمان، حتى ما حدا يعرف إذا الطلب موجود.

جرّبناها على النظام الحقيقي:
```
connect with a fake token      refused: unauthorized
Alice joins admin channel      {"ok":false,"error":"forbidden"}
admin joins admin channel      {"ok":true}
Alice joins Bob's order        {"ok":false,"error":"forbidden"}
admin dashboard got new order  #3661722f from alice...@demo.local, $37.50, after 28 ms
Alice joins her own order      {"ok":true}
Alice's tracking page got      status "confirmed" after 21 ms
Bob heard about Alice          nothing
```

---

## 8. الاختبارات

```powershell
docker compose -p ecommerce-local up -d
cd backend
npm run test:e2e
```
**39 اختبار** (31 قديم + 8 جداد)، كلهن نجحوا 3 مرات ورا بعض. الاختبارات بتستعمل exchange وطوابير لحالها (`test.*`) وبتمسحها بالآخر، فما بتلمس الطوابير الحقيقية ولا بتبعت بريد حقيقي.

| الاختبار | شو بيثبت |
|---|---|
| answers the order at once, and the worker sends the confirmation email later | الطلب بينقبل والعامل واقف، والبريد بيوصل لما يشتغل، وفيه رقم الطلب والمنتج والمجموع |
| ⭐ PROOF: stopping the worker, even in the middle of an email, loses no email | عامل بيموت بنص البريد + طلبين والعامل واقف ← العامل الجديد بيبعت التلاتة |
| retries a temporary failure, and the email still arrives | فشل مرة، نجح بالمحاولة التانية، والـ DLQ فاضي |
| ⭐ PROOF: an email that always fails is retried, then moved to the dead-letter queue | 3 محاولات بالضبط، وبعدين DLQ مع السبب |
| refuses a connection without a valid token | بدون توكن أو بتوكن مزيّف ← مرفوض |
| closes the connection when the token expires | توكن عمرو ثانية ← الاتصال بيسكّر |
| lets a customer follow only their own order, and only an admin join the admin channel | كل حالات الصلاحيات |
| ⭐ PROOF: a new order shows at once on the admin channel, and the approval at once on the customer page | أقل من ثانيتين لكل وحدة، وزبون تاني ما بيسمع شي |

---

## 9. البريد الحقيقي (لازم تعملوه قبل المقابلة)

المتطلب بيقول **"بريد حقيقي عبر خدمة بريد خارجية"**. افتراضياً البريد بيروح لـ **Mailpit**، وهو أداة تطوير محلية بتلقط البريد وبتعرضو، **مش خدمة خارجية**. لإرسال بريد حقيقي:

1. انسخوا `.env.example` لملف اسمو `.env` بنفس المجلد (جنب `docker-compose.yml`). هالملف ما بيطلع على git.
2. عبّوا إعدادات SMTP. الأسهل **Gmail**: فعّلوا التحقق بخطوتين، واعملوا **App password** من إعدادات الحساب، وحطوه بـ `SMTP_PASS`.
3. `docker compose -p ecommerce-local up -d worker`
4. سجّلوا زبون **بإيميلكن الحقيقي** واعملوا طلب، وشوفوا البريد بصندوقكن.

**جرّبناه بحساب Gmail حقيقي** (`hassandalshake@gmail.com`): Gmail قبل تسجيل الدخول، والطلب رجع 201 بـ 0.09 ثانية، والعامل بعت البريد (`email sent`)، **ووصل لصندوق الوارد**. الإعدادات بملف `.env` المحلي، وما بيطلع على git.

**للرجوع لـ Mailpit:** غيّروا اسم الملف `.env` (مثلاً `.env.off`) وشغّلوا `docker compose -p ecommerce-local up -d worker`.

---

## 10. العرض قدام المعيد

**قبل:** افتحوا نافذتين للواجهة (عادية للأدمن، و Incognito للزبون)، وصفحة RabbitMQ (`localhost:15672`)، وصفحة Mailpit (`localhost:8025`) أو صندوق بريدكن.

1. **الأدمن:** صفحة **Live dashboard** ← بيطلع **Live** بالأخضر.
2. **الزبون:** منتج ← Add to cart ← Cart ← **Place order** ← بيفتح لحالو صفحة **Track live**.
   - ⭐ بنفس اللحظة الطلب بيظهر بلوحة الأدمن، معلّم بالأخضر.
   - البريد بيوصل خلال ثانية.
3. ⭐ **الأدمن:** **Approve** ← صفحة الزبون بتصير **Confirmed** لحالها.
4. ⭐ **إيقاف العامل:**
   ```powershell
   docker compose -p ecommerce-local stop worker
   ```
   اعملوا طلبين ← بصفحة RabbitMQ، طابور `emails` بيصير فيه 2 (الصفحة بتتحدث كل 5 ثواني). وما في بريد جديد.
   ```powershell
   docker compose -p ecommerce-local start worker
   ```
   ← الطابور بيفضى، والإيميلين بيوصلوا.
5. **الـ DLQ (إذا سأل):** بصفحة RabbitMQ، طابور `emails.dlq`. أو شغّلوا اختبار الـ PROOF تبع الـ DLQ.
6. **الصلاحيات (إذا سأل):** اختبار `lets a customer follow only their own order...`.

---

## 11. أسئلة متوقعة بالمقابلة

**ليش طابور، وما منبعت البريد مباشرة بالطلب؟**
البريد بطيء (ثواني)، وممكن يفشل. لو بعتناه مباشرة، الزبون بيستنى، وإذا خادم البريد واقف بيفشل الطلب كلو. مع الطابور الطلب بيرجع فوراً، والبريد بيتأخر شوي بس ما بيضيع.

**شو بيصير إذا RabbitMQ واقف وقت الطلب؟**
الطلب بينجح، والحدث بيستنى بجدول `outbox_events` بقاعدة البيانات. أول ما يرجع RabbitMQ بينبعت. هاد الـ Outbox Pattern، وجربناه.

**ليش ما منحفظ الطلب وبعدين منبعت الحدث وخلص؟**
لأنو بين الخطوتين ممكن يصير عطل، فبيضيع الحدث. بالـ outbox الاتنين بنفس الـ transaction.

**إذا العامل وقع بنص الإرسال؟**
ما عمل ack، فالرسالة بترجع للطابور لحالها والعامل الجاي بياخدها. الـ ack بعد ما البريد ينبعت بس.

**يعني ممكن يوصل بريدين لنفس الطلب؟**
نعم، بحالة نادرة: العامل بعت البريد ووقع قبل الـ ack. هاد اسمو **at-least-once**. اخترنا "ممكن يتكرر" على "ممكن يضيع"، لأنو المتطلب "ما يضيع". الحل الكامل: نسجّل رقم الرسالة (`messageId`) لكل بريد انبعت ونتجاهل المكرر. ما عملناه.

**شو الـ DLQ وليش؟**
Dead Letter Queue: مكان للرسائل يلي فشلت كل محاولاتها. بدونو يا منرميها (بتضيع)، يا منعيدها للأبد (بتسد الطابور). بالـ DLQ بتنحفظ مع السبب، وحدا بيقدر يشوفها ويعيد إرسالها.

**كيف بتصير إعادة المحاولة بعد 5 ثواني؟**
طابور `emails.retry` إلو TTL 5 ثواني. الرسالة بتستنى فيه، ولما تنتهي مدتها RabbitMQ بيرجعها لحالو لطابور `emails` (dead-letter routing). وعدد المحاولات بالـ header `x-attempts`.

**كيف بتمنعوا زبون يتابع طلب غيره؟**
عند الاشتراك بقناة الطلب منستعمل نفس `OrdersService.findOne` تبع `GET /orders/:id`، يعني نفس القاعدة بالضبط. وبدون توكن صالح ما في اتصال أصلاً.

**وإذا انتهى التوكن والاتصال مفتوح؟**
السيرفر بيسكّر الاتصال لحالو وقت انتهاء التوكن، والواجهة بترجع لتسجيل الدخول.

**ليش Socket.IO مو polling؟**
مع polling كل شاشة بتسأل السيرفر كل كم ثانية: ضغط بلا فايدة، وتأخير. هون السيرفر هو يلي بيبعت وقت يصير الحدث، بأقل من 30 ms.

**ليش كل نسخة API إلها طابور مؤقت لحالها؟**
حتى كل نسخة تسمع كل حدث. إذا صار في 3 نسخ API، زبون متصل بالنسخة 2 لازم يوصلو الحدث حتى لو الطلب انعمل عن طريق النسخة 1.

---

## 12. حدود (قولوها بصراحة)

1. **البريد الحقيقي:** مجرّب بحساب Gmail، بس Gmail المجاني إلو حد يومي (حوالي 500 رسالة)، وهو مخصص للتجربة مو لمتجر حقيقي. بالإنتاج منستعمل خدمة بريد للمعاملات (متل Brevo أو SES)، وبنفس الكود لأنو SMTP.
2. **at-least-once:** بحالة نادرة جداً ممكن يوصل البريد مرتين (قسم 11).
3. **الإيميلات للعناوين الوهمية:** الزبائن الوهميين (`@seed.local`) والاختبارات بعناوين مش حقيقية. مع خدمة بريد حقيقية، بريدهن رح يفشل. فعند استعمال بريد حقيقي، اعملوا الطلبات بإيميل حقيقي.
4. **RabbitMQ نسخة وحدة** (مو cluster). إذا خربت قاعدتها بالكامل، الرسائل يلي جواتها بتضيع. بالإنتاج منستعمل cluster مع quorum queues.
5. **ترتيب الأحداث** مضمون بنسخة API وحدة. مع أكتر من نسخة ممكن يتبدّل ترتيب حدثين لطلبين مختلفين، وهاد ما بيأثر هون.

---

## 13. شو تغيّر بالمشروع

| الملف | التغيير |
|---|---|
| `backend/src/messaging/broker.ts` | أسماء الـ exchange والطوابير، شكل الأحداث، والاتصال (مشترك بين الـ API والعامل) |
| `backend/src/events/` | جدول `outbox_events` والمرحّل يلي بيبعتو لـ RabbitMQ |
| `backend/src/realtime/` | قنوات Socket.IO مع الصلاحيات، ومستمع RabbitMQ يلي بيغذّيها |
| `backend/src/worker/` | العامل: `email-worker.ts` (المنطق) و`main.ts` (SMTP) |
| `backend/src/orders/orders.service.ts` | الطلب والحدث بـ transaction وحدة، ونفس الشي لتغيير الحالة |
| `backend/src/users/users.service.ts` | `contactOf()`: اسم وإيميل المستخدم لباقي الوحدات |
| `backend/src/products/products.service.ts` | `getPrices()` صارت `getForOrder()` وبترجع الاسم كمان |
| `docker-compose.yml` | خدمات `rabbitmq` و`worker` و`mailpit` |
| `.env.example` | إعدادات البريد الحقيقي |
| `backend/test/requirement4.e2e-spec.ts` | 8 اختبارات (4 منها PROOF) |
| `backend/test/global-setup.ts` | بيمسح طوابير الاختبارات بعد ما يخلصوا |
| `frontend/src/socket.js` | الاتصال والاشتراك |
| `frontend/src/pages/Dashboard.jsx` | **Live dashboard** للأدمن |
| `frontend/src/pages/OrderTracking.jsx` | **Track live** للزبون |
| `frontend/src/pages/Orders.jsx` و `Cart.jsx` | زر Track live، وبعد الطلب بتنفتح صفحة التتبّع لحالها |
