import { Server } from 'socket.io';

const isId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

/** Pushes score changes to everyone watching. Viewers can only listen. */
export function createLive(server, config) {
  const io = new Server(server, { cors: { origin: config.corsOrigin }, maxHttpBufferSize: 1e4 });

  io.on('connection', (socket) => {
    socket.on('watch', (matchId) => isId(matchId) && socket.join(`match:${matchId}`));
    socket.on('unwatch', (matchId) => isId(matchId) && socket.leave(`match:${matchId}`));
    socket.on('lobby:join', () => socket.join('lobby'));
    socket.on('lobby:leave', () => socket.leave('lobby'));
  });

  const listChanged = () => io.to('lobby').emit('matches:changed');

  return {
    io,
    listChanged,
    matchChanged(view) {
      io.to(`match:${view.id}`).emit('match:update', view);
      listChanged();
    },
    matchDeleted(matchId) {
      io.to(`match:${matchId}`).emit('match:deleted', matchId);
      listChanged();
    },
  };
}
