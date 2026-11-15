import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Empty, PageHeader } from '../components.jsx';

export default function Notifications({ token }) {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/notifications', { token }).then(setNotifications, (e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader title="Notifications" subtitle="Updates about your orders." />
      <Alert>{error}</Alert>
      {notifications?.length === 0 && <Empty>You have no notifications yet.</Empty>}

      <div className="stack">
        {notifications?.map((n) => (
          <div key={n.id} className="card notification">
            <span className="notification-icon">🔔</span>
            <div>
              <p>{n.message}</p>
              <p className="muted small">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
