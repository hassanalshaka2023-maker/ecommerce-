import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Empty, money, PageHeader, Thumb } from '../components.jsx';

const LIMIT = 8;

export default function Products({ token, isAdmin, go }) {
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  function load() {
    const query = new URLSearchParams({ page, limit: LIMIT });
    if (category) query.set('category', category);
    api(`/products?${query}`).then(setResult, (e) => setError(e.message));
  }

  useEffect(load, [category, page]);

  async function addProduct(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    // Stock lives in the warehouse service, so it is sent in a second request.
    const quantity = Number(data.get('stock'));
    data.delete('stock');
    try {
      const product = await api('/products', { method: 'POST', body: data, token });
      await api(`/products/${product.id}/stock`, { method: 'PUT', body: { quantity }, token });
      form.reset();
      setShowForm(false);
      setError('');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / LIMIT));

  return (
    <>
      <PageHeader title="Products" subtitle={result && `${result.total} products available`}>
        <div className="row">
          <input
            className="search"
            placeholder="Filter by category…"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          />
          {isAdmin && (
            <button className="btn" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Close' : '+ New product'}
            </button>
          )}
        </div>
      </PageHeader>

      {showForm && (
        <form className="card stack" style={{ marginBottom: '1.75rem' }} onSubmit={addProduct}>
          <h3>New product</h3>
          <div className="form-grid">
            <label className="field">
              Name
              <input name="name" placeholder="Wireless headphones" required />
            </label>
            <label className="field">
              Price
              <input name="price" placeholder="49.99" required />
            </label>
            <label className="field">
              Category
              <input name="category" placeholder="electronics" required />
            </label>
            <label className="field">
              Warehouse stock
              <input name="stock" type="number" min="0" step="1" placeholder="10" required />
            </label>
            <label className="field wide">
              Image (JPEG, PNG or WEBP)
              <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
            </label>
            <label className="field wide">
              Description
              <textarea name="description" rows="3" placeholder="Short description" />
            </label>
          </div>
          <div className="row">
            <button type="submit" className="btn">
              Save product
            </button>
          </div>
        </form>
      )}

      <Alert>{error}</Alert>

      {result?.items.length === 0 && <Empty>No products found.</Empty>}

      <div className="grid">
        {result?.items.map((product) => (
          <div key={product.id} className="product-card" onClick={() => go('product', { id: product.id })}>
            <Thumb product={product} />
            <div className="product-body">
              <span className="badge">{product.category}</span>
              <h3>{product.name}</h3>
              <span className="price">{money(product.price)}</span>
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
