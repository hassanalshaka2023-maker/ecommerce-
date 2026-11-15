import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Empty, money, PageHeader } from '../components.jsx';

const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const LIMIT = 10;

export default function Orders({ token, isAdmin, go }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    api(`/orders?page=${page}&limit=${LIMIT}`, { token }).then(setResult, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, [page]);

  const orders = result?.items;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / LIMIT));

  async function changeStatus(id, status) {
    try {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: { status }, token });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHeader
        title={isAdmin ? 'All orders' : 'My orders'}
        subtitle={result && `${result.total} order(s)`}
      />
      <Alert>{error}</Alert>
      {orders?.length === 0 && <Empty>No orders yet.</Empty>}

      <div className="stack">
        {orders?.map((order) => (
          <div key={order.id} className="card stack">
            <div className="row spread">
              <div>
                <strong>Order #{order.id.slice(0, 8)}</strong>
                <p className="muted small">{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              {isAdmin ? (
                <select
                  className="status-select"
                  value={order.status}
                  onChange={(e) => changeStatus(order.id, e.target.value)}
                >
                  {STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              ) : (
                <div className="row">
                  <span className={`badge ${order.status}`}>{order.status}</span>
                  <button className="btn secondary" onClick={() => go('order', { id: order.id })}>
                    Track live
                  </button>
                </div>
              )}
            </div>

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
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="row pagination">
          <button className="btn secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            ← Previous
          </button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <button className="btn secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </>
  );
}
