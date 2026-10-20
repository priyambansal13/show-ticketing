import type { Socket } from 'socket.io';
import { PUBLIC_SEAT_STATUS, SeatsGateway } from './seats.gateway.js';

const SHOW = 'a'.repeat(24);
const socketDouble = (rooms: string[] = []) =>
  ({ rooms: new Set(['socket-id', ...rooms]), join: vi.fn(), leave: vi.fn() }) as unknown as Socket & {
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
  };

describe('SeatsGateway', () => {
  const gateway = new SeatsGateway();

  it('joins a show room for valid ids only', () => {
    const socket = socketDouble();
    expect(gateway.join(socket, SHOW)).toEqual({ ok: true });
    expect(socket.join).toHaveBeenCalledWith(`show:${SHOW}`);
    expect(gateway.join(socket, 'not-an-id')).toEqual({ ok: false });
    expect(gateway.join(socket, { $ne: null })).toEqual({ ok: false });
  });

  it('limits how many shows one socket can follow', () => {
    const socket = socketDouble(['show:1', 'show:2', 'show:3']);
    expect(gateway.join(socket, SHOW)).toEqual({ ok: false });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('leaves rooms', () => {
    const socket = socketDouble([`show:${SHOW}`]);
    expect(gateway.leave(socket, SHOW)).toEqual({ ok: true });
    expect(socket.leave).toHaveBeenCalledWith(`show:${SHOW}`);
    expect(gateway.leave(socket, 42)).toEqual({ ok: false });
  });

  it('is a no-op before the server is initialised and exposes only public statuses', () => {
    expect(() => gateway.emitSeatChange(SHOW, ['A1'], 'HELD')).not.toThrow();
    gateway.afterInit();
    expect(PUBLIC_SEAT_STATUS('AVAILABLE')).toBe('AVAILABLE');
    for (const status of ['HELD', 'BOOKED', 'BLOCKED'] as const) expect(PUBLIC_SEAT_STATUS(status)).toBe('UNAVAILABLE');
  });
});
