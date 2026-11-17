import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, money, Thumb } from '../components.jsx';

function StockBadge({ product }) {
  if (product.stock === null) return <span className="badge warning">Stock unavailable</span>;
  if (product.stock === 0) return <span className="badge danger">Out of stock</span>;
  return <span className="badge success">{product.stock} in stock</span>;
}

export default function ProductDetails({ id, token, isAdmin, isCustomer, onAddToCart, go }) {
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState(null);

  const load = () =>
    api(`/products/${id}`).then(setProduct, (e) => setMessage({ type: 'error', text: e.message }));
  useEffect(() => {
    load();
  }, [id]);

  async function setStock(event) {
    event.preventDefault();
    const stock = Number(new FormData(event.target).get('stock'));
    try {
      await api(`/products/${id}/stock`, { method: 'PUT', body: { quantity: stock }, token });
      setMessage({ type: 'success', text: 'Stock updated.' });
      event.target.reset();
      load();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    try {
      await api(`/products/${id}`, { method: 'PATCH', body, token });
      setMessage({ type: 'success', text: 'Product updated.' });
      load();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    }
  }

  function addToCart() {
    onAddToCart(product, quantity);
    setMessage({ type: 'success', text: `${quantity} × ${product.name} added to your cart.` });
  }

  return (
    <>
      <button className="btn secondary" style={{ marginBottom: '1.5rem' }} onClick={() => go('products')}>
        ← Back to products
      </button>

      {!product ? (
        <Alert type={message?.type}>{message?.text}</Alert>
      ) : (
        <div className="card details">
          <Thumb product={product} />

          <div className="stack">
            <span className="badge">{product.category}</span>
            <h1>{product.name}</h1>
            <span className="price big">{money(product.price)}</span>
            {product.description && <p className="muted">{product.description}</p>}

            <StockBadge product={product} />
            {product.stock === null && <Alert type="warning">{product.stockError}</Alert>}

            {isCustomer && (
              <div className="row">
                <input
                  className="qty"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
                <button className="btn" disabled={product.stock === 0} onClick={addToCart}>
                  Add to cart
                </button>
              </div>
            )}
            {!token && <p className="muted small">Sign in to order this product.</p>}

            {isAdmin && (
              <form className="card stack" onSubmit={saveDetails}>
                <h3>Edit product</h3>
                <label className="field">
                  Name
                  <input name="name" defaultValue={product.name} required />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Price
                    <input name="price" defaultValue={product.price} required />
                  </label>
                  <label className="field">
                    Category
                    <input name="category" defaultValue={product.category} required />
                  </label>
                </div>
                <label className="field">
                  Description
                  <textarea name="description" rows="2" defaultValue={product.description ?? ''} />
                </label>
                <div className="row">
                  <button type="submit" className="btn">
                    Save changes
                  </button>
                </div>
              </form>
            )}

            {isAdmin && (
              <form className="card stack" onSubmit={setStock}>
                <h3>Warehouse stock</h3>
                <div className="row">
                  <input name="stock" type="number" min="0" placeholder="New quantity" required />
                  <button type="submit" className="btn">
                    Update
                  </button>
                </div>
              </form>
            )}

            <Alert type={message?.type}>{message?.text}</Alert>
          </div>
        </div>
      )}
    </>
  );
}
