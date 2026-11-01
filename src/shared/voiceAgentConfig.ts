/**
 * Shared Voice Agent configuration + `Settings` payload builder.
 *
 * Single source of truth for both the Node proxy and the browser client, so the
 * exact payload Deepgram receives is unit-tested against the documented schema:
 *   https://developers.deepgram.com/reference/voice-agent/voice-agent
 *   https://developers.deepgram.com/docs/configure-voice-agent
 *   https://developers.deepgram.com/docs/voice-agent-tts-models
 */

export interface TurnDetectionConfig {
  /** End-of-turn confidence required to finish a turn (0.5 - 1.0). */
  eotThreshold: number;
  /**
   * Confidence required to fire an **eager** end-of-turn (0.3 - 0.9). Setting
   * this is what lets the agent start the LLM before the turn is confirmed
   * ("speculative replies"). Flux (v2) listen models only.
   */
  eagerEotThreshold: number;
  /** Hard cap: finish the turn after this much silence (ms, default 5000). */
  eotTimeoutMs: number;
}

export interface ProviderRef {
  provider: string;
  model: string;
}

export interface AgentModelConfig {
  listenProvider: string;
  listenModel: string;
  /**
   * BCP-47 language for the listen provider. v1 (nova) sends `language`;
   * v2 (flux) only supports `language_hints`, and only for `flux-general-multi`.
   */
  listenLanguage?: string;
  thinkProvider: string;
  thinkModel: string;
  speakProvider: string;
  speakModel: string;
  /**
   * Explicit TTS family override. In practice it is derived from the voice name
   * (`flux-*` => v2, `aura-*` => v1) — see `speakProviderVersion()`.
   */
  speakVersion?: string;
  /** Speaking rate multiplier (Aura 0.7-1.5, Flux 0.5-1.5). */
  speakSpeed?: number;
  /** Input PCM sample rate sent to the agent (linear16). */
  sampleRate: number;
  /** Input PCM encoding sent to the agent. */
  encoding: string;
  /** Optional low-latency end-of-turn tuning (Flux/v2 only). */
  turnDetection?: TurnDetectionConfig;
  /** Optional spoken greeting, played as soon as the session is ready. */
  greeting?: string;
  /** Optional system prompt for the thinking model. */
  prompt?: string;
  /** `settings.flags.history` (default true) — controls `History` events. */
  history?: boolean;
  /** Optional ordered fallback provider for the LLM (schema allows an array). */
  thinkFallback?: ProviderRef;
  /** Optional ordered fallback provider for TTS (schema allows an array). */
  speakFallback?: ProviderRef;
}

/** Audio format used by this prototype: mono linear16. */
export const AGENT_INPUT_SAMPLE_RATE = 24000;
export const AGENT_OUTPUT_SAMPLE_RATE = 24000;
export const AGENT_SAMPLE_ENCODING = 'linear16';

/** Official Voice Agent endpoint. Overridable only for local testing. */
export const DEFAULT_AGENT_WS_URL = 'wss://agent.deepgram.com/v1/agent/converse';

/**
 * Measured starting point for Flux speculative replies: fire the eager
 * end-of-turn early (0.4) while keeping a high-confidence final threshold (0.7)
 * so a false start is cheap, and cap an idle turn at 2 s instead of the 5 s
 * default.
 */
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
  history: true,
};

/** Models the `open_ai` think provider accepts (verbatim from the API schema). */
export const OPENAI_THINK_MODELS = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
] as const;

/** Encodings the Voice Agent `audio.input` schema accepts. */
export const INPUT_ENCODINGS = ['linear16', 'linear32', 'flac', 'alaw', 'mulaw', 'opus', 'ogg_opus'] as const;

/** Flux (v2) listen models support end-of-turn tuning; nova-* (v1) do not. */
export function isFluxListenModel(model: string): boolean {
  return typeof model === 'string' && /^flux/i.test(model.trim());
}

/** Flux multilingual is the only listen model that accepts `language_hints`. */
export function supportsLanguageHints(model: string): boolean {
  return typeof model === 'string' && /^flux-general-multi$/i.test(model.trim());
}

/**
 * Deepgram TTS families are selected by `provider.version`: Flux voices stream
 * on the v2 endpoint, Aura voices live on v1 (the server default). Sending `v2`
 * with an Aura model makes the agent resolve the wrong TTS endpoint and fail, so
 * the version is derived from the model family.
 */
export function speakProviderVersion(model: string, configured?: string): string {
  const name = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (name.startsWith('flux')) return 'v2';
  if (name.startsWith('aura')) return 'v1';
  return configured === 'v2' || configured === 'v1' ? configured : 'v2';
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce an untrusted (client supplied) config into a complete config object. */
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
    history: raw.history === undefined ? (base.history ?? true) : Boolean(raw.history),
  };

  const listenLanguage = typeof raw.listenLanguage === 'string' ? raw.listenLanguage.trim() : '';
  if (listenLanguage) cfg.listenLanguage = listenLanguage;

  const greeting = typeof raw.greeting === 'string' ? raw.greeting.trim() : '';
  if (greeting) cfg.greeting = greeting;

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (prompt) cfg.prompt = prompt;

  if (raw.speakSpeed !== undefined) {
    cfg.speakSpeed = asNumber(raw.speakSpeed, 1, 0.5, 1.5);
  }

  const td = raw.turnDetection as Record<string, unknown> | undefined;
  if (isFluxListenModel(listenModel) && td && typeof td === 'object') {
    const fallback = base.turnDetection || DEFAULT_TURN_DETECTION;
    cfg.turnDetection = {
      eotThreshold: asNumber(td.eotThreshold, fallback.eotThreshold, 0.5, 1),
      eagerEotThreshold: asNumber(td.eagerEotThreshold, fallback.eagerEotThreshold, 0.3, 0.9),
      eotTimeoutMs: Math.round(asNumber(td.eotTimeoutMs, fallback.eotTimeoutMs, 200, 10000)),
    };
  }

  for (const key of ['thinkFallback', 'speakFallback'] as const) {
    const fb = raw[key] as Record<string, unknown> | undefined;
    if (fb && typeof fb === 'object') {
      const provider = asString(fb.provider, '');
      const model = asString(fb.model, '');
      if (provider && model) cfg[key] = { provider, model };
    }
  }

  return cfg;
}

export interface ValidationResult {
  config: AgentModelConfig;
  /** Human-readable corrections; forwarded to the UI as `Warning` events. */
  warnings: string[];
}

/**
 * Validate a normalized config against the documented schema and repair what can
 * be repaired, so the proxy never sends a payload that produces a fatal
 * `INVALID_SETTINGS` error mid-session.
 */
export function validateAgentConfig(input: AgentModelConfig): ValidationResult {
  const config: AgentModelConfig = { ...input };
  const warnings: string[] = [];

  // --- thinking model must exist for the configured provider
  if (config.thinkProvider === 'open_ai' && !OPENAI_THINK_MODELS.includes(config.thinkModel as any)) {
    warnings.push(
      `Think model "${config.thinkModel}" is not accepted by the open_ai provider ` +
        `(valid: ${OPENAI_THINK_MODELS.join(', ')}). Using "${DEFAULT_AGENT_CONFIG.thinkModel}".`
    );
    config.thinkModel = DEFAULT_AGENT_CONFIG.thinkModel;
  }

  // --- TTS family must match the voice name
  const expectedSpeakVersion = speakProviderVersion(config.speakModel, config.speakVersion);
  if (config.speakVersion && config.speakVersion !== expectedSpeakVersion) {
    warnings.push(
      `Speak version "${config.speakVersion}" does not match voice "${config.speakModel}"; using "${expectedSpeakVersion}".`
    );
  }
  config.speakVersion = expectedSpeakVersion;

  // --- speaking rate range depends on the TTS family
  if (config.speakSpeed !== undefined) {
    const min = config.speakVersion === 'v2' ? 0.5 : 0.7;
    const clamped = Math.min(1.5, Math.max(min, Math.round(config.speakSpeed * 20) / 20));
    if (clamped !== config.speakSpeed) {
      warnings.push(`Speak speed ${config.speakSpeed} is outside ${min}-1.5 for ${config.speakVersion}; using ${clamped}.`);
    }
    config.speakSpeed = clamped;
  }

  // --- input encoding/rate
  if (!INPUT_ENCODINGS.includes(config.encoding as any)) {
    warnings.push(`Unsupported input encoding "${config.encoding}"; using linear16.`);
    config.encoding = 'linear16';
  }
  if (config.encoding !== 'linear16') {
    // The capture pipeline always produces 16-bit PCM.
    warnings.push(`This client captures linear16 PCM; overriding input encoding "${config.encoding}".`);
    config.encoding = 'linear16';
  }
  if (!Number.isFinite(config.sampleRate) || config.sampleRate < 8000 || config.sampleRate > 48000) {
    warnings.push(`Unsupported input sample rate ${config.sampleRate}; using ${AGENT_INPUT_SAMPLE_RATE}.`);
    config.sampleRate = AGENT_INPUT_SAMPLE_RATE;
  }

  // --- end-of-turn tuning only exists for Flux (v2) listen models
  if (config.turnDetection && !isFluxListenModel(config.listenModel)) {
    warnings.push(
      `End-of-turn tuning (eager_eot_threshold/eot_timeout_ms) requires a Flux v2 listen model; ` +
        `ignored for "${config.listenModel}".`
    );
    delete config.turnDetection;
  }
  if (config.turnDetection) {
    const td = config.turnDetection;
    if (td.eagerEotThreshold >= td.eotThreshold) {
      warnings.push(
        `eager_eot_threshold (${td.eagerEotThreshold}) must be below eot_threshold (${td.eotThreshold}); ` +
          `using ${DEFAULT_TURN_DETECTION.eagerEotThreshold}.`
      );
      td.eagerEotThreshold = DEFAULT_TURN_DETECTION.eagerEotThreshold;
    }
  }

  // --- language hints are only valid on flux-general-multi
  if (config.listenLanguage && isFluxListenModel(config.listenModel) && !supportsLanguageHints(config.listenModel)) {
    warnings.push(
      `listenLanguage is only supported by flux-general-multi; "${config.listenModel}" carries its language in the ` +
        `model name. Language setting ignored.`
    );
    delete config.listenLanguage;
  }

  return { config, warnings };
}

/**
 * Build the exact `Settings` message documented for the Voice Agent API.
 * Contains no client-only fields (e.g. `ConfigureSettings`).
 *
 * Verified against the API reference on 2026-10-31:
 *  - top level: `type`, `flags.history`, `audio`, `agent`
 *  - `audio.input`: `encoding`, `sample_rate`
 *  - `audio.output`: `encoding`, `sample_rate`, `container`
 *  - `agent.listen.provider`: `type`, `model`, (+ `version` "v2" for flux,
 *    `eot_threshold` / `eager_eot_threshold` / `eot_timeout_ms` for flux,
 *    `language` for nova, `language_hints` for flux-general-multi)
 *  - `agent.think`: `provider{type,model}` | array, optional `prompt`
 *  - `agent.speak`: `provider{type,model,version,speed}` | array
 *  - `agent.greeting` (optional)
 */
export function buildAgentSettingsMessage(cfg: AgentModelConfig): Record<string, unknown> {
  const flux = isFluxListenModel(cfg.listenModel);

  const listenProvider: Record<string, unknown> = {
    type: cfg.listenProvider,
    model: cfg.listenModel,
  };
  if (flux) {
    listenProvider.version = 'v2';
    if (cfg.turnDetection) {
      listenProvider.eot_threshold = cfg.turnDetection.eotThreshold;
      listenProvider.eager_eot_threshold = cfg.turnDetection.eagerEotThreshold;
      listenProvider.eot_timeout_ms = cfg.turnDetection.eotTimeoutMs;
    }
    if (cfg.listenLanguage && supportsLanguageHints(cfg.listenModel)) {
      listenProvider.language_hints = [cfg.listenLanguage];
    }
  } else if (cfg.listenLanguage) {
    listenProvider.language = cfg.listenLanguage;
  }

  const thinkProvider = { type: cfg.thinkProvider, model: cfg.thinkModel };
  const think: Record<string, unknown> | Record<string, unknown>[] = cfg.thinkFallback
    ? [
        { provider: thinkProvider },
        { provider: { type: cfg.thinkFallback.provider, model: cfg.thinkFallback.model } },
      ]
    : { provider: thinkProvider };
  if (cfg.prompt) {
    // A prompt only makes sense on an object form; arrays are fallback chains.
    if (Array.isArray(think)) {
      (think[0] as Record<string, unknown>).prompt = cfg.prompt;
    } else {
      think.prompt = cfg.prompt;
    }
  }

  const speakProvider: Record<string, unknown> = {
    type: cfg.speakProvider,
    model: cfg.speakModel,
    version: speakProviderVersion(cfg.speakModel, cfg.speakVersion),
  };
  if (cfg.speakSpeed !== undefined) speakProvider.speed = cfg.speakSpeed;
  const speak: Record<string, unknown> | Record<string, unknown>[] = cfg.speakFallback
    ? [
        { provider: speakProvider },
        {
          provider: {
            type: cfg.speakFallback.provider,
            model: cfg.speakFallback.model,
            version: speakProviderVersion(cfg.speakFallback.model),
          },
        },
      ]
    : { provider: speakProvider };

  const agent: Record<string, unknown> = {
    listen: { provider: listenProvider },
    think,
    speak,
  };
  if (cfg.greeting) agent.greeting = cfg.greeting;

  return {
    type: 'Settings',
    flags: { history: cfg.history ?? true },
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

/** Convenience: normalize → validate → build (what the proxy does per session). */
export function buildValidatedSettings(input: unknown): {
  settings: Record<string, unknown>;
  config: AgentModelConfig;
  warnings: string[];
} {
  const normalized = normalizeAgentConfig(input);
  const { config, warnings } = validateAgentConfig(normalized);
  return { settings: buildAgentSettingsMessage(config), config, warnings };
}
