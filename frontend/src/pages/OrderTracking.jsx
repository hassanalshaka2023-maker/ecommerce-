import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, money, PageHeader } from '../components.jsx';
import { connect, subscribe } from '../socket.js';

const STEPS = ['pending', 'confirmed', 'shipped', 'delivered'];

export default function OrderTracking({ id, token, go }) {
  const [order, setOrder] = useState(null);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api(`/orders/${id}`, { token }).then(setOrder, (e) => setError(e.message));

    const socket = connect(token);
    // After every (re)connection: join the channel again (the server forgets the channels of a
    // dropped socket) and reload, in case the status changed while the connection was down.
    socket.on('connect', async () => {
      load();
      setLive((await subscribe(socket, { channel: 'order', orderId: id })).ok);
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('order.status_changed', (event) => {
      setOrder((current) => current && { ...current, status: event.status });
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    });
    return () => socket.disconnect();
  }, [id]);

  const current = STEPS.indexOf(order?.status);

  return (
    <>
      <button className="btn secondary" style={{ marginBottom: '1.5rem' }} onClick={() => go('orders')}>
        ← Back to my orders
      </button>
      <PageHeader title={order ? `Order #${order.id.slice(0, 8)}` : 'Order'} subtitle="The status updates here by itself, no refresh needed.">
        <span className={`live ${live ? 'on' : ''}`}>{live ? 'Live' : 'Connecting…'}</span>
      </PageHeader>
      <Alert>{error}</Alert>

      {order && (
        <div className={`card stack ${flash ? 'flash' : ''}`}>
          {order.status === 'cancelled' ? (
            <Alert type="error">This order was cancelled.</Alert>
          ) : (
            <div className="timeline">
              {STEPS.map((step, index) => (
                <div key={step} className={`step ${index < current ? 'done' : ''} ${index === current ? 'current' : ''}`}>
                  {step}
                </div>
              ))}
            </div>
          )}

          <ul className="order-items">
            {order.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.quantity} × Product #{item.productId.slice(0, 8)}
                </span>
                <span className="muted">{money(item.unitPrice * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="row spread">
            <span className="muted">Total</span>
            <span className="price">{money(order.totalPrice)}</span>
          </div>
          <p className="muted small">A confirmation email is on its way to you.</p>
        </div>
      )}
    </>
  );
}
