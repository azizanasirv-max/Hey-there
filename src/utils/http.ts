/**
 * HTTP helpers with an explicit status contract.
 *
 * HTTP `202 Accepted` is a **success** meaning "the request was accepted for
 * asynchronous processing", not a failure and not a WebSocket upgrade. The
 * backend (or an intermediary in front of it) may answer `/api/health` with 202
 * while the container/queue is warming up, optionally with a job id and a
 * `Retry-After`/`Location` hint.
 *
 * This module turns raw HTTP responses into an explicit state so the UI can show
 * "starting…" and retry instead of reporting the backend as offline forever.
 */

import type { BackendHealthResponse } from '../types/deepgram';

export type BackendHealthState = 'ready' | 'starting' | 'unavailable' | 'error';

export interface HealthProbeResult {
  state: BackendHealthState;
  httpStatus: number | null;
  health: BackendHealthResponse | null;
  /** Human-readable, specific message. */
  message: string;
  /** Suggested delay before the next probe (from Retry-After), when provided. */
  retryAfterMs: number | null;
  /** Async job / session id from a 202 body, when provided. */
  jobId: string | null;
}

export const DEFAULT_RETRY_AFTER_MS = 1500;

/** Parse `Retry-After` (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function extractJobId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  for (const key of ['job_id', 'jobId', 'session_id', 'sessionId', 'request_id', 'id']) {
    const v = b[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { __nonJsonBody: text.slice(0, 120) };
  }
}

/**
 * Probe the backend health endpoint, handling 200/202/204 and broken bodies
 * distinctly (no `res.ok` shortcut).
 */
export async function probeBackendHealth(
  url = '/api/health',
  init: RequestInit = { cache: 'no-store' }
): Promise<HealthProbeResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err: any) {
    return {
      state: 'error',
      httpStatus: null,
      health: null,
      message: `Backend unreachable: ${err?.message || err}. Check that the server is running and reachable.`,
      retryAfterMs: null,
      jobId: null,
    };
  }

  const status = res.status;
  const retryAfterMs =
    parseRetryAfter(res.headers.get('retry-after')) ??
    (status === 202 ? DEFAULT_RETRY_AFTER_MS : null);

  // 202 Accepted — the request is queued / the service is warming up.
  if (status === 202) {
    const body = await readJsonSafe(res).catch(() => null);
    const jobId = extractJobId(body);
    return {
      state: 'starting',
      httpStatus: status,
      health: null,
      message:
        'Backend accepted the health probe asynchronously (HTTP 202 Accepted). ' +
        (jobId ? `Request id ${jobId}. ` : '') +
        'Waiting for the service to become ready…',
      retryAfterMs,
      jobId,
    };
  }

  if (status === 204) {
    return {
      state: 'starting',
      httpStatus: status,
      health: null,
      message: 'Backend is starting (HTTP 204 No Content). Waiting for readiness…',
      retryAfterMs,
      jobId: null,
    };
  }

  if (status >= 400) {
    const body = await readJsonSafe(res).catch(() => null);
    const detail = (body as any)?.description || (body as any)?.message || res.statusText || '';
    return {
      state: 'unavailable',
      httpStatus: status,
      health: null,
      message: `Backend returned HTTP ${status}${detail ? `: ${detail}` : '.'}`,
      retryAfterMs,
      jobId: null,
    };
  }

  if (status < 200 || status >= 300) {
    return {
      state: 'error',
      httpStatus: status,
      health: null,
      message: `Unexpected HTTP ${status} from the health endpoint.`,
      retryAfterMs,
      jobId: null,
    };
  }

  // 200-299 (other than 202/204): the body must be the documented JSON.
  const body = await readJsonSafe(res).catch(() => null);
  const asHealth = body as BackendHealthResponse | null;
  if (!asHealth || typeof asHealth !== 'object' || typeof asHealth.status !== 'string') {
    const preview = (body as any)?.__nonJsonBody;
    return {
      state: 'error',
      httpStatus: status,
      health: null,
      message:
        `HTTP ${status} but the body is not the health payload` +
        (preview ? ` (received: ${JSON.stringify(preview)})` : '') +
        '. A proxy or SPA fallback may be answering /api/health instead of the backend.',
      retryAfterMs,
      jobId: null,
    };
  }

  if (asHealth.status !== 'ok') {
    return {
      state: 'starting',
      httpStatus: status,
      health: asHealth,
      message: `Backend reported status "${asHealth.status}" — waiting for it to become ready…`,
      retryAfterMs,
      jobId: null,
    };
  }

  return {
    state: 'ready',
    httpStatus: status,
    health: asHealth,
    message: asHealth.deepgramApiKeyConfigured
      ? 'Backend ready.'
      : 'Backend ready, but DEEPGRAM_API_KEY is not configured.',
    retryAfterMs: null,
    jobId: null,
  };
}

export interface UpgradeProbeResult {
  ok: boolean;
  httpStatus: number | null;
  message: string;
}

/**
 * Diagnose the WebSocket endpoint over plain HTTP.
 *
 * A WebSocket upgrade must be answered with `101 Switching Protocols`. If an
 * intermediary answers with a buffered HTTP status instead (200 HTML from a SPA
 * fallback, 202 Accepted from an async edge, 3xx/4xx), the browser only reports
 * an opaque WebSocket error — this probe turns it into a specific message.
 */
export async function probeAgentUpgrade(
  wsUrl: string,
  timeoutMs = 2000
): Promise<UpgradeProbeResult> {
  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(httpUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller?.signal,
      headers: { 'Sec-WebSocket-Version': '13' },
    });
    const status = res.status;
    if (status === 426 || status === 400 || status === 200 || status === 101) {
      return { ok: true, httpStatus: status, message: `WebSocket endpoint reachable (HTTP ${status}).` };
    }
    if (status === 202) {
      return {
        ok: false,
        httpStatus: status,
        message:
          'An intermediary answered the WebSocket endpoint with HTTP 202 Accepted instead of 101 Switching ' +
          'Protocols. The request was queued asynchronously, so no WebSocket exists — check that your host/proxy ' +
          'forwards upgrades for /api/agent-proxy.',
      };
    }
    if (status === 404 || status === 405) {
      return {
        ok: false,
        httpStatus: status,
        message: `The WebSocket path is not routed to the proxy (HTTP ${status}). Check the reverse-proxy/route config for /api/agent-proxy.`,
      };
    }
    if (status >= 500) {
      return { ok: false, httpStatus: status, message: `The proxy route returned HTTP ${status}.` };
    }
    return { ok: status < 400, httpStatus: status, message: `WebSocket endpoint responded with HTTP ${status}.` };
  } catch (err: any) {
    return {
      ok: false,
      httpStatus: null,
      message: `Could not reach the WebSocket endpoint: ${err?.message || err}.`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
