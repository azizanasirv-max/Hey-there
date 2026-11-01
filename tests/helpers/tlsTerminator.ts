/**
 * Local stand-in for a TLS-terminating edge (Render, Cloudflare, an ALB).
 *
 * Render terminates TLS *before* the app: the browser speaks `https://` and
 * `wss://`, the container only ever sees plain `http://` + `ws://` plus
 * `X-Forwarded-Proto: https`. This helper reproduces that topology so the
 * HTTPS/WSS upgrade path can be tested for real instead of assumed.
 *
 * It generates a throwaway self-signed certificate (tests/.certs, git-ignored)
 * and forwards both regular requests and `upgrade` requests to the local app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import net from 'node:net';
import path from 'node:path';

import { ROOT } from './proxyHarness';

const CERT_DIR = path.join(ROOT, 'tests', '.certs');

export interface TlsTerminator {
  /** e.g. https://127.0.0.1:PORT */
  url: string;
  port: number;
  close: () => Promise<void>;
  /** Secure WebSocket URL for a given path. */
  wssUrl: (pathname?: string) => string;
}

function ensureCertificate(): { key: string; cert: string } {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(CERT_DIR, { recursive: true });
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' }
    );
  }
  return { key: readFileSync(keyPath, 'utf-8'), cert: readFileSync(certPath, 'utf-8') };
}

export async function startTlsTerminator(targetPort: number, targetHost = '127.0.0.1'): Promise<TlsTerminator> {
  const { key, cert } = ensureCertificate();

  const withForwardedHeaders = (headers: Record<string, unknown>, hostHeader?: string) => ({
    ...headers,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': hostHeader ?? 'localhost',
    'x-forwarded-for': '203.0.113.7',
  });

  const server = createHttpsServer({ key, cert }, (req, res) => {
    const proxyReq = httpRequest(
      {
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: withForwardedHeaders(req.headers as Record<string, unknown>, req.headers.host),
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('bad gateway');
    });
    req.pipe(proxyReq);
  });

  server.on('upgrade', (req, socket, head) => {
    const backend = net.connect(targetPort, targetHost, () => {
      const headers = withForwardedHeaders(req.headers as Record<string, unknown>, req.headers.host);
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
      }
      backend.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head && head.length) backend.write(head);
      backend.pipe(socket);
      socket.pipe(backend);
    });
    backend.on('error', () => socket.destroy());
    socket.on('error', () => backend.destroy());
  });

  const port: number = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  return {
    url: `https://127.0.0.1:${port}`,
    port,
    wssUrl: (pathname = '/api/agent-proxy') => `wss://127.0.0.1:${port}${pathname}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
