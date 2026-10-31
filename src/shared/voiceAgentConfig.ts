/**
 * Shared Voice Agent configuration helpers.
 *
 * Used by both the Node proxy (`server.ts`) and the browser client so the
 * `Settings` payload that Deepgram receives is always built (and therefore
 * tested) in exactly one place.
 *
 * Schema reference: https://developers.deepgram.com/docs/configure-voice-agent
 */

export interface TurnDetectionConfig {
  /** End-of-turn confidence required to finish a turn (0.5 - 1.0). */
  eotThreshold: number;
  /** Confidence required to fire an eager (speculative) end-of-turn (0.3 - 0.9). */
  eagerEotThreshold: number;
  /** Hard cap: finish the turn after this much silence (ms). */
  eotTimeoutMs: number;
}

export interface AgentModelConfig {
  listenProvider: string;
  listenModel: string;
  thinkProvider: string;
  thinkModel: string;
  speakProvider: string;
  speakModel: string;
  speakVersion?: string;
  /** Input PCM sample rate sent to the agent (linear16). */
  sampleRate: number;
  /** Input PCM encoding sent to the agent. */
  encoding: string;
  /**
   * Optional low-latency end-of-turn tuning. Only sent when the listen model is
   * a Flux (v2) model, because `eot_*` fields are rejected by the v1 provider.
   */
  turnDetection?: TurnDetectionConfig;
  /** Optional spoken greeting played as soon as the session is ready. */
  greeting?: string;
}

/** Input/output audio format used by this prototype (linear16 mono). */
export const AGENT_INPUT_SAMPLE_RATE = 24000;
export const AGENT_OUTPUT_SAMPLE_RATE = 24000;
export const AGENT_SAMPLE_ENCODING = 'linear16';

/** Official Voice Agent endpoint. Overridable only for local testing. */
export const DEFAULT_AGENT_WS_URL = 'wss://agent.deepgram.com/v1/agent/converse';

export const DEFAULT_TURN_DETECTION: TurnDetectionConfig = {
  eotThreshold: 0.7,
  eagerEotThreshold: 0.4,
  eotTimeoutMs: 2000,
};

export const DEFAULT_AGENT_CONFIG: AgentModelConfig = {
  listenProvider: 'deepgram',
  listenModel: 'nova-3',
  thinkProvider: 'open_ai',
  thinkModel: 'gpt-4o-mini',
  speakProvider: 'deepgram',
  speakModel: 'flux-kit-en',
  speakVersion: 'v2',
  sampleRate: AGENT_INPUT_SAMPLE_RATE,
  encoding: AGENT_SAMPLE_ENCODING,
};

/** Flux (v2) listen models support end-of-turn tuning; nova-* (v1) do not. */
export function isFluxListenModel(model: string): boolean {
  return typeof model === 'string' && /^flux/i.test(model.trim());
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Coerce an untrusted (client supplied) config object into a valid
 * `AgentModelConfig`, falling back to the defaults for anything missing.
 */
export function normalizeAgentConfig(
  input: unknown,
  base: AgentModelConfig = DEFAULT_AGENT_CONFIG
): AgentModelConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const listenModel = asString(raw.listenModel, base.listenModel);

  const cfg: AgentModelConfig = {
    listenProvider: asString(raw.listenProvider, base.listenProvider),
    listenModel,
    thinkProvider: asString(raw.thinkProvider, base.thinkProvider),
    thinkModel: asString(raw.thinkModel, base.thinkModel),
    speakProvider: asString(raw.speakProvider, base.speakProvider),
    speakModel: asString(raw.speakModel, base.speakModel),
    speakVersion: asString(raw.speakVersion, base.speakVersion || 'v2'),
    sampleRate: asNumber(raw.sampleRate, base.sampleRate, 8000, 48000),
    encoding: asString(raw.encoding, base.encoding),
  };

  if (raw.greeting !== undefined) {
    const greeting = asString(raw.greeting, '');
    if (greeting) cfg.greeting = greeting;
  }

  // `turnDetection` is only meaningful (and only accepted) for Flux models.
  const td = raw.turnDetection as Record<string, unknown> | undefined;
  if (isFluxListenModel(listenModel) && td && typeof td === 'object') {
    const fallback = base.turnDetection || DEFAULT_TURN_DETECTION;
    cfg.turnDetection = {
      eotThreshold: asNumber(td.eotThreshold, fallback.eotThreshold, 0.5, 1),
      eagerEotThreshold: asNumber(td.eagerEotThreshold, fallback.eagerEotThreshold, 0.3, 0.9),
      eotTimeoutMs: Math.round(asNumber(td.eotTimeoutMs, fallback.eotTimeoutMs, 200, 10000)),
    };
  }

  return cfg;
}

/**
 * Build the exact `Settings` message documented for the Voice Agent API.
 * Contains no client-only fields (e.g. `ConfigureSettings`).
 */
export function buildAgentSettingsMessage(cfg: AgentModelConfig): Record<string, unknown> {
  const listenProvider: Record<string, unknown> = {
    type: cfg.listenProvider,
    model: cfg.listenModel,
  };

  if (isFluxListenModel(cfg.listenModel)) {
    // Flux models are served by the v2 STT API and support end-of-turn tuning.
    listenProvider.version = 'v2';
    if (cfg.turnDetection) {
      listenProvider.eot_threshold = cfg.turnDetection.eotThreshold;
      listenProvider.eager_eot_threshold = cfg.turnDetection.eagerEotThreshold;
      listenProvider.eot_timeout_ms = cfg.turnDetection.eotTimeoutMs;
    }
  }

  const agent: Record<string, unknown> = {
    listen: { provider: listenProvider },
    think: {
      provider: {
        type: cfg.thinkProvider,
        model: cfg.thinkModel,
      },
    },
    speak: {
      provider: {
        type: cfg.speakProvider,
        model: cfg.speakModel,
        version: cfg.speakVersion || 'v2',
      },
    },
  };

  if (cfg.greeting) agent.greeting = cfg.greeting;

  return {
    type: 'Settings',
    audio: {
      input: {
        encoding: cfg.encoding,
        sample_rate: cfg.sampleRate,
      },
      output: {
        encoding: 'linear16',
        sample_rate: AGENT_OUTPUT_SAMPLE_RATE,
        container: 'none',
      },
    },
    agent,
  };
}
