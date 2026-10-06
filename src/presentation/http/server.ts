import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export const listen = (app: Express, port: number): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = app.listen(port, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(server);
    });
  });

export const boundPort = (server: Server): number => (server.address() as AddressInfo).port;

/** Live count of open TCP connections, for the `active_connections{resource="http"}` gauge. */
export const trackConnections = (server: Server): (() => number) => {
  let open = 0;
  server.on('connection', (socket) => {
    open += 1;
    socket.once('close', () => {
      open -= 1;
    });
  });
  return () => open;
};

/** Stops accepting connections and resolves once in-flight requests are done. */
export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections();
  });
