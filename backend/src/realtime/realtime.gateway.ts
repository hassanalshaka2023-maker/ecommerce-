import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { type AuthUser, Role } from '../common/auth.js';
import { OrdersService } from '../orders/orders.service.js';

// Two channels, each checked before anyone joins:
//   admin           admins only: new orders and every status change
//   order:<id>      the owner of that order (or an admin): its status changes
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly orders: OrdersService,
  ) {}

  afterInit(server: Server) {
    // Nobody connects without a valid token, and the connection ends when the token expires.
    server.use((socket, next) => {
      try {
        const { sub, role, exp } = this.jwt.verify(socket.handshake.auth.token);
        socket.data.user = { id: sub, role } satisfies AuthUser;
        const timer = setTimeout(
          () => socket.disconnect(true),
          exp * 1000 - Date.now(),
        );
        socket.once('disconnect', () => clearTimeout(timer));
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body?: { channel?: string; orderId?: string },
  ) {
    const user: AuthUser = socket.data.user;

    if (body?.channel === 'admin') {
      if (user.role !== Role.ADMIN) return { ok: false, error: 'forbidden' };
      await socket.join('admin');
      return { ok: true };
    }

    if (body?.channel === 'order' && typeof body.orderId === 'string') {
      try {
        // The same rule as GET /orders/:id: a customer can only follow their own order.
        await this.orders.findOne(body.orderId, user);
      } catch {
        return { ok: false, error: 'forbidden' };
      }
      await socket.join(`order:${body.orderId}`);
      return { ok: true };
    }

    return { ok: false, error: 'unknown channel' };
  }
}
