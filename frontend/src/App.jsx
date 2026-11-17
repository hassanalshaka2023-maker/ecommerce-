import { useState } from 'react';
import Auth from './pages/Auth.jsx';
import Cart from './pages/Cart.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Notifications from './pages/Notifications.jsx';
import OrderTracking from './pages/OrderTracking.jsx';
import Orders from './pages/Orders.jsx';
import ProductDetails from './pages/ProductDetails.jsx';
import Products from './pages/Products.jsx';

const saved = JSON.parse(localStorage.getItem('session') ?? 'null');

export default function App() {
  const [session, setSession] = useState(saved);
  const [page, setPage] = useState({ name: 'products' });
  const [cart, setCart] = useState([]);

  const user = session?.user;
  const token = session?.accessToken;
  const isAdmin = user?.role === 'admin';
  const go = (name, params) => setPage({ name, ...params });

  function login(newSession) {
    localStorage.setItem('session', JSON.stringify(newSession));
    setSession(newSession);
    go('products');
  }

  function logout() {
    localStorage.removeItem('session');
    setSession(null);
    setCart([]);
    go('products');
  }

  function addToCart(product, quantity) {
    setCart((items) => [
      ...items.filter((item) => item.product.id !== product.id),
      { product, quantity },
    ]);
  }

  const links = [
    { name: 'products', label: 'Products', show: true },
    { name: 'cart', label: 'Cart', show: user && !isAdmin, count: cart.length },
    { name: 'orders', label: isAdmin ? 'All orders' : 'My orders', show: user },
    { name: 'notifications', label: 'Notifications', show: user && !isAdmin },
    { name: 'dashboard', label: 'Live dashboard', show: isAdmin },
  ];

  const pages = {
    products: <Products token={token} isAdmin={isAdmin} go={go} />,
    product: (
      <ProductDetails
        id={page.id}
        token={token}
        isAdmin={isAdmin}
        isCustomer={user && !isAdmin}
        onAddToCart={addToCart}
        go={go}
      />
    ),
    cart: <Cart token={token} cart={cart} setCart={setCart} go={go} />,
    orders: <Orders token={token} isAdmin={isAdmin} go={go} />,
    order: <OrderTracking id={page.id} token={token} go={go} />,
    dashboard: <Dashboard token={token} />,
    notifications: <Notifications token={token} />,
    auth: <Auth onLogin={login} />,
  };

  return (
    <>
      <header className="navbar">
        <div className="brand" onClick={() => go('products')}>
          <span className="brand-logo">◆</span> ShopLine
        </div>

        <nav className="nav-links">
          {links
            .filter((link) => link.show)
            .map((link) => (
              <button
                key={link.name}
                className={`nav-link ${page.name === link.name ? 'active' : ''}`}
                onClick={() => go(link.name)}
              >
                {link.label}
                {link.count > 0 && <span className="count">{link.count}</span>}
              </button>
            ))}
        </nav>

        {user ? (
          <div className="user">
            <span className="avatar">{user.name[0].toUpperCase()}</span>
            <div>
              <div className="user-name">{user.name}</div>
              <span className={`badge ${isAdmin ? 'primary' : ''}`}>{user.role}</span>
            </div>
            <button className="btn secondary" onClick={logout}>
              Log out
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => go('auth')}>
            Sign in
          </button>
        )}
      </header>
      <main>{pages[page.name]}</main>
    </>
  );
}
