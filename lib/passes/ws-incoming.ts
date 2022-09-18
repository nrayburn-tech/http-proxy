import * as http from 'http';
import { IncomingHttpHeaders, IncomingMessage } from 'http';
import * as https from 'https';
import {
  getPort,
  hasEncryptedConnection,
  isSSL,
  setupOutgoing,
  setupSocket,
} from '../common';
import { Socket } from 'net';
import { ServerOptions } from '../types';
import { ProxyServerNew, WebSocketErrorCallback } from '../index';

/*
 * Array of passes.
 *
 * A `pass` is just a function that is executed on `req, socket, options`
 * so that you can easily add new checks while still keeping the base
 * flexible.
 */

/*
 * Websockets Passes
 *
 */

export type WebSocketIncomingPass = (
  this: ProxyServerNew,
  req: IncomingMessage,
  socket: Socket,
  options: ServerOptions,
  head: Buffer,
  server: ProxyServerNew,
  errorCallback?: WebSocketErrorCallback,
) => boolean | unknown;

/**
 * WebSocket requests must have the `GET` method and
 * the `upgrade:websocket` header
 *
 * @internal
 */
export const checkMethodAndHeader: WebSocketIncomingPass = (req, socket) => {
  if (req.method !== 'GET' || !req.headers.upgrade) {
    socket.destroy();
    return true;
  }

  if (req.headers.upgrade.toLowerCase() !== 'websocket') {
    socket.destroy();
    return true;
  }
};

/**
 * Sets `x-forwarded-*` headers if specified in config.
 *
 * @internal
 */
export const XHeaders: WebSocketIncomingPass = (req, socket, options) => {
  if (!options.xfwd) return;

  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: getPort(req),
    proto: hasEncryptedConnection(req) ? 'wss' : 'ws',
  };

  (['for', 'port', 'proto'] as const).forEach(function (header) {
    req.headers['x-forwarded-' + header] =
      (req.headers['x-forwarded-' + header] || '') +
      (req.headers['x-forwarded-' + header] ? ',' : '') +
      values[header];
  });
};

/**
 * Does the actual proxying. Make the request and upgrade it
 * send the Switching Protocols request and pipe the sockets.
 *
 * @internal
 */
export const stream: WebSocketIncomingPass = (
  req,
  socket,
  options,
  head,
  server,
  clb,
) => {
  const createHttpHeader = function (
    line: string,
    headers: IncomingHttpHeaders,
  ) {
    return (
      Object.keys(headers)
        .reduce(
          function (head, key) {
            const value = headers[key];

            if (!Array.isArray(value)) {
              head.push(key + ': ' + value);
              return head;
            }

            for (let i = 0; i < value.length; i++) {
              head.push(key + ': ' + value[i]);
            }
            return head;
          },
          [line],
        )
        .join('\r\n') + '\r\n\r\n'
    );
  };

  setupSocket(socket);

  if (head && head.length) socket.unshift(head);

  const proxyReq = (isSSL.test(options.target.protocol) ? https : http).request(
    setupOutgoing(options.ssl || {}, options, req),
  );

  // Enable developers to modify the proxyReq before headers are sent
  if (server) {
    server.emit('proxyReqWs', proxyReq, req, socket, options, head);
  }

  // Error Handler
  proxyReq.on('error', onOutgoingError);
  proxyReq.on('response', function (res) {
    // TODO: Does this actually do anything?  `upgrade` isn't on `res`.
    // if upgrade event isn't going to happen, close the socket
    if (!res.upgrade) {
      socket.write(
        createHttpHeader(
          'HTTP/' +
            res.httpVersion +
            ' ' +
            res.statusCode +
            ' ' +
            res.statusMessage,
          res.headers,
        ),
      );
      res.pipe(socket);
    }
  });

  proxyReq.on('upgrade', function (proxyRes, proxySocket, proxyHead) {
    proxySocket.on('error', onOutgoingError);

    // Allow us to listen when the websocket has completed
    proxySocket.on('end', function () {
      server.emit('close', proxyRes, proxySocket, proxyHead);
    });

    // The pipe below will end proxySocket if socket closes cleanly, but not
    // if it errors (eg, vanishes from the net and starts returning
    // EHOSTUNREACH). We need to do that explicitly.
    socket.on('error', function () {
      proxySocket.end();
    });

    setupSocket(proxySocket);

    if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead);

    //
    // Remark: Handle writing the headers to the socket when switching protocols
    // Also handles when a header is an array
    //
    socket.write(
      createHttpHeader('HTTP/1.1 101 Switching Protocols', proxyRes.headers),
    );

    proxySocket.pipe(socket).pipe(proxySocket);

    server.emit('open', proxySocket);
    server.emit('proxySocket', proxySocket); //DEPRECATED.
  });

  return proxyReq.end(); // XXX: CHECK IF THIS IS THIS CORRECT

  function onOutgoingError(err: Error) {
    if (clb) {
      clb(err, req, socket);
    } else {
      server.emit('error', err, req, socket);
    }
    socket.end();
  }
};

export const websocketIncomingPasses = [checkMethodAndHeader, XHeaders, stream];
