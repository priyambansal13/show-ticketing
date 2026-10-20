import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'socket.io';

type IoServerOptions = NonNullable<Parameters<IoAdapter['createIOServer']>[1]>;

/**
 * Socket.IO with CORS from configuration and the Redis adapter, so a seat
 * update emitted on one API instance reaches clients connected to any instance.
 */
/** Open sockets allowed per client IP on one instance (public, unauthenticated namespace). */
export const MAX_SOCKETS_PER_IP = 20;

export class SocketIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly socketsPerIp = new Map<string, number>();

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
    redis: Redis,
    private readonly trustProxyHops = 0,
  ) {
    super(app);
    this.pub = redis.duplicate();
    this.sub = redis.duplicate();
    for (const client of [this.pub, this.sub]) client.on('error', () => undefined); // reconnects; main client logs
  }

  override createIOServer(port: number, options?: IoServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
      // Seat updates are tiny; refuse large frames from clients.
      maxHttpBufferSize: 10_000,
      allowRequest: (req, callback) => callback(null, (this.socketsPerIp.get(this.clientIp(req)) ?? 0) < MAX_SOCKETS_PER_IP),
    } as IoServerOptions) as Server;
    server.adapter(createAdapter(this.pub, this.sub));
    server.engine.on('connection', (raw: { request: IncomingMessage; once(event: 'close', fn: () => void): void }) => {
      const ip = this.clientIp(raw.request);
      this.socketsPerIp.set(ip, (this.socketsPerIp.get(ip) ?? 0) + 1);
      raw.once('close', () => {
        const left = (this.socketsPerIp.get(ip) ?? 1) - 1;
        if (left <= 0) this.socketsPerIp.delete(ip);
        else this.socketsPerIp.set(ip, left);
      });
    });
    return server;
  }

  /** Same rule as Express `trust proxy`: take the address `trustProxyHops` from the right of X-Forwarded-For. */
  private clientIp(req: IncomingMessage): string {
    const direct = req.socket.remoteAddress ?? 'unknown';
    if (this.trustProxyHops === 0) return direct;
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return forwarded[forwarded.length - this.trustProxyHops] ?? direct;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    this.pub.disconnect();
    this.sub.disconnect();
  }
}
