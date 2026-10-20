import { Logger, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { SeatStatus } from '../../generated/prisma/enums.js';
import { MetricsService } from '../../infra/metrics/metrics.service.js';

const SHOW_ID = /^[0-9a-f]{24}$/;
const MAX_ROOMS_PER_SOCKET = 3;

/** What customers see: held and booked are both just "unavailable". */
export const PUBLIC_SEAT_STATUS = (status: SeatStatus) => (status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE');

/**
 * Live seat-map updates. Clients connect to namespace `/seats`, emit
 * `show:join` with a showId, and receive `seats:update` { showId, seatIds, status }.
 * Read-only and public (no PII is broadcast). Fan-out across API instances via
 * the Socket.IO Redis adapter (configured in main.ts).
 */
// CORS and the Redis fan-out adapter are configured once in SocketIoAdapter (bootstrap).
@WebSocketGateway({ namespace: '/seats' })
export class SeatsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SeatsGateway.name);

  constructor(@Optional() private readonly metrics?: MetricsService) {}

  @WebSocketServer()
  private server?: Server;

  afterInit(): void {
    this.logger.log('Seat updates gateway ready on /seats');
  }

  handleConnection(): void {
    this.metrics?.wsConnections.inc({ namespace: '/seats' });
  }

  handleDisconnect(): void {
    this.metrics?.wsConnections.dec({ namespace: '/seats' });
  }

  @SubscribeMessage('show:join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() showId: unknown): { ok: boolean } {
    if (typeof showId !== 'string' || !SHOW_ID.test(showId)) return { ok: false };
    const rooms = [...socket.rooms].filter((room) => room.startsWith('show:'));
    if (rooms.length >= MAX_ROOMS_PER_SOCKET) return { ok: false };
    void socket.join(`show:${showId}`);
    return { ok: true };
  }

  @SubscribeMessage('show:leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() showId: unknown): { ok: boolean } {
    if (typeof showId !== 'string' || !SHOW_ID.test(showId)) return { ok: false };
    void socket.leave(`show:${showId}`);
    return { ok: true };
  }

  emitSeatChange(showId: string, seatIds: string[], status: SeatStatus): void {
    this.server?.to(`show:${showId}`).emit('seats:update', { showId, seatIds, status: PUBLIC_SEAT_STATUS(status) });
  }
}
