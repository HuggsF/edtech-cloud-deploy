import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { boundPort, closeServer, listen, trackConnections } from '@presentation/http/server';

describe('HTTP Server Lifecycle', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await closeServer(server).catch(() => undefined);
      server = null;
    }
  });

  it('starts listening, detects bound port and closes gracefully', async () => {
    const app = express();
    app.get('/ping', (_req, res) => {
      res.send('pong');
    });

    server = await listen(app, 0);
    const port = boundPort(server);
    expect(port).toBeGreaterThan(0);

    await closeServer(server);
    server = null;
  });

  it('tracks open and closed socket connections accurately', () => {
    const fakeServer = new EventEmitter() as unknown as Server;
    const openCount = trackConnections(fakeServer);
    expect(openCount()).toBe(0);

    const fakeSocket = new EventEmitter();
    fakeServer.emit('connection', fakeSocket);
    expect(openCount()).toBe(1);

    fakeSocket.emit('close');
    expect(openCount()).toBe(0);
  });

  it('rejects if listen fails with invalid port', async () => {
    const app = express();
    await expect(listen(app, -1)).rejects.toThrow();
  });
});
