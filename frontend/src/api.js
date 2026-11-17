// One place for every backend call: adds the token, sends JSON or files, and
// turns the backend's error format into a readable message.
export async function api(path, { method = 'GET', body, token } = {}) {
  const isFile = body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && !isFile && { 'Content-Type': 'application/json' }),
    },
    body: isFile ? body : body && JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (response.status === 401 && token) {
    // The token expired (they last one hour): forget the session and start from the login again.
    localStorage.removeItem('session');
    location.reload();
  }
  if (!response.ok) {
    throw new Error([data?.message ?? response.statusText].flat().join(' · '));
  }
  return data;
}
