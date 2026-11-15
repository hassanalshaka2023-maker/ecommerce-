import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Empty, money, PageHeader } from '../components.jsx';
import { connect, subscribe } from '../socket.js';

export default function Dashboard({ token }) {
  const [orders, setOrders] = useState(null);
  const [live, setLive] = useState(false);
  const [fresh, setFresh] = useState({}); // orders that just arrived, to highlight them
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api('/orders?limit=20', { token }).then((result) => setOrders(result.items), (e) => setError(e.message));

    const socket = connect(token);
    // After every (re)connection: join again, and reload what may have happened while disconnected.
    socket.on('connect', async () => {
      load();
      setLive((await subscribe(socket, { channel: 'admin' })).ok);
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('order.created', ({ order, customer }) => {
      setOrders((list) => list && [{ ...order, customer }, ...list.filter((o) => o.id !== order.id)].slice(0, 30));
      setFresh((f) => ({ ...f, [order.id]: true }));
      setTimeout(() => setFresh((f) => ({ ...f, [order.id]: false })), 4000);
    });
    socket.on('order.status_changed', (event) =>
      setOrders((list) => list && list.map((o) => (o.id === event.orderId ? { ...o, status: event.status } : o))),
    );
    return () => socket.disconnect();
  }, []);

  // The new status comes back through the channel, so the row updates by itself.
  const approve = (id) =>
    api(`/orders/${id}/status`, { method: 'PATCH', body: { status: 'confirmed' }, token }).catch((e) => setError(e.message));

  return (
    <>
      <PageHeader title="Live dashboard" subtitle="New orders appear here the moment they are placed.">
        <span className={`live ${live ? 'on' : ''}`}>{live ? 'Live' : 'Connecting…'}</span>
      </PageHeader>
      <Alert>{error}</Alert>
      {orders?.length === 0 && <Empty>No orders yet. Place one from another window and watch it arrive.</Empty>}

      <div className="stack">
        {orders?.map((order) => (
          <div key={order.id} className={`card row spread ${fresh[order.id] ? 'new' : ''}`}>
            <div>
              <strong>Order #{order.id.slice(0, 8)}</strong>
              <p className="muted small">
                {order.customer ? `${order.customer.name} · ${order.customer.email}` : `Customer #${order.userId.slice(0, 8)}`}
                {' · '}
                {new Date(order.createdAt).toLocaleTimeString()}
              </p>
            </div>
            <span className="price">{money(order.totalPrice)}</span>
            <span className={`badge ${order.status}`}>{order.status}</span>
            {order.status === 'pending' ? (
              <button className="btn" onClick={() => approve(order.id)}>
                Approve
              </button>
            ) : (
              <span style={{ width: '5.5rem' }} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
