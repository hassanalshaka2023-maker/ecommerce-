import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Empty, money, PageHeader, Thumb } from '../components.jsx';

export default function Cart({ token, cart, setCart, go }) {
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);
  const total = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  async function checkout() {
    const items = cart.map(({ product, quantity }) => ({ productId: product.id, quantity }));
    setPlacing(true);
    try {
      const order = await api('/orders', { method: 'POST', body: { items }, token });
      setCart([]);
      go('order', { id: order.id }); // straight to the live page of the new order
    } catch (e) {
      setError(e.message);
    } finally {
      setPlacing(false);
    }
  }

  const remove = (id) => setCart(cart.filter((item) => item.product.id !== id));

  return (
    <>
      <PageHeader title="Your cart" subtitle={`${cart.length} item(s)`} />

      {cart.length === 0 ? (
        <Empty>
          <p>Your cart is empty.</p>
          <button className="btn" style={{ marginTop: '1rem' }} onClick={() => go('products')}>
            Browse products
          </button>
        </Empty>
      ) : (
        <div className="cart">
          <div className="card">
            {cart.map(({ product, quantity }) => (
              <div key={product.id} className="line">
                <Thumb product={product} size="small" />
                <div className="grow">
                  <strong>{product.name}</strong>
                  <p className="muted small">
                    {quantity} × {money(product.price)}
                  </p>
                </div>
                <strong>{money(product.price * quantity)}</strong>
                <button className="btn ghost" onClick={() => remove(product.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="card stack">
            <h3>Summary</h3>
            <div className="row spread">
              <span className="muted">Total</span>
              <span className="price big">{money(total)}</span>
            </div>
            <Alert>{error}</Alert>
            <button className="btn block" disabled={placing} onClick={checkout}>
              {placing ? 'Placing order…' : 'Place order'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
