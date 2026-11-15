import { useState } from 'react';
import { api } from '../api.js';
import { Alert } from '../components.jsx';

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const isLogin = mode === 'login';

  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    try {
      onLogin(await api(`/auth/${mode}`, { method: 'POST', body: form }));
    } catch (e) {
      setError(e.message);
    }
  }

  function switchTo(newMode) {
    setMode(newMode);
    setError('');
  }

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1>{isLogin ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">
            {isLogin ? 'Sign in to place and track your orders.' : 'It only takes a minute.'}
          </p>
        </div>

        <div className="tabs">
          <button type="button" className={`tab ${isLogin ? 'active' : ''}`} onClick={() => switchTo('login')}>
            Sign in
          </button>
          <button type="button" className={`tab ${isLogin ? '' : 'active'}`} onClick={() => switchTo('register')}>
            Register
          </button>
        </div>

        {!isLogin && (
          <label className="field">
            Full name
            <input name="name" placeholder="Lina Haddad" required />
          </label>
        )}
        <label className="field">
          Email
          <input name="email" type="email" placeholder="you@example.com" required />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" placeholder="At least 8 characters" required />
        </label>

        <Alert>{error}</Alert>
        <button type="submit" className="btn block">
          {isLogin ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
