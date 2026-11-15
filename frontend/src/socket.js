import { io } from 'socket.io-client';

// One live connection. The server checks the token before it accepts the connection, and checks
// the role (admin channel) or the owner (order channel) again before a screen may join a channel.
export function connect(token) {
  const socket = io({ auth: { token }, transports: ['websocket'] });
  socket.on('connect_error', (error) => {
    if (error.message === 'unauthorized') {
      localStorage.removeItem('session'); // the token expired: start from the login again
      location.reload();
    }
  });
  return socket;
}

// Answers { ok: true } or { ok: false, error }.
export const subscribe = (socket, channel) => socket.emitWithAck('subscribe', channel);
