import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_TURN_DETECTION,
  buildAgentSettingsMessage,
  isFluxListenModel,
  normalizeAgentConfig,
  speakProviderVersion,
} from '../src/shared/voiceAgentConfig';

test('default settings match the documented Voice Agent schema', () => {
  const msg: any = buildAgentSettingsMessage(DEFAULT_AGENT_CONFIG);
  assert.equal(msg.type, 'Settings');
  assert.deepEqual(msg.audio.input, { encoding: 'linear16', sample_rate: 24000 });
  assert.deepEqual(msg.audio.output, { encoding: 'linear16', sample_rate: 24000, container: 'none' });
  assert.deepEqual(msg.agent.listen.provider, { type: 'deepgram', model: 'nova-3' });
  assert.deepEqual(msg.agent.think.provider, { type: 'open_ai', model: 'gpt-4o-mini' });
  assert.deepEqual(msg.agent.speak.provider, { type: 'deepgram', model: 'flux-kit-en', version: 'v2' });
  // No client-only fields may leak into the Deepgram payload.
  assert.equal('config' in msg, false);
  assert.equal(msg.type === 'ConfigureSettings', false);
});

test('nova (v1) listen providers never receive flux-only eot fields', () => {
  const msg: any = buildAgentSettingsMessage({
    ...DEFAULT_AGENT_CONFIG,
    listenModel: 'nova-3',
    turnDetection: { ...DEFAULT_TURN_DETECTION },
  });
  assert.equal(msg.agent.listen.provider.version, undefined);
  assert.equal(msg.agent.listen.provider.eot_threshold, undefined);
  assert.equal(msg.agent.listen.provider.eager_eot_threshold, undefined);
  assert.equal(msg.agent.listen.provider.eot_timeout_ms, undefined);
});

test('flux listen models are sent with v2 + end-of-turn tuning', () => {
  const msg: any = buildAgentSettingsMessage({
    ...DEFAULT_AGENT_CONFIG,
    listenModel: 'flux-general-en',
    turnDetection: { eotThreshold: 0.6, eagerEotThreshold: 0.4, eotTimeoutMs: 2000 },
  });
  assert.equal(msg.agent.listen.provider.version, 'v2');
  assert.equal(msg.agent.listen.provider.eot_threshold, 0.6);
  assert.equal(msg.agent.listen.provider.eager_eot_threshold, 0.4);
  assert.equal(msg.agent.listen.provider.eot_timeout_ms, 2000);
});

test('isFluxListenModel detects flux models only', () => {
  assert.equal(isFluxListenModel('flux-general-en'), true);
  assert.equal(isFluxListenModel('FLUX-general-multi'), true);
  assert.equal(isFluxListenModel('nova-3'), false);
  assert.equal(isFluxListenModel(''), false);
});

test('normalizeAgentConfig rejects junk and clamps values', () => {
  const cfg = normalizeAgentConfig({
    listenModel: '  nova-2 ',
    thinkModel: '',
    sampleRate: 'not-a-number',
    encoding: 42,
  });
  assert.equal(cfg.listenModel, 'nova-2');
  assert.equal(cfg.thinkModel, DEFAULT_AGENT_CONFIG.thinkModel);
  assert.equal(cfg.sampleRate, DEFAULT_AGENT_CONFIG.sampleRate);
  assert.equal(cfg.encoding, DEFAULT_AGENT_CONFIG.encoding);
});

test('normalizeAgentConfig ignores turn detection for non-flux models', () => {
  const cfg = normalizeAgentConfig({
    listenModel: 'nova-3',
    turnDetection: { eotThreshold: 0.9, eagerEotThreshold: 0.8, eotTimeoutMs: 500 },
  });
  assert.equal(cfg.turnDetection, undefined);
});

test('normalizeAgentConfig clamps flux turn detection into documented ranges', () => {
  const cfg = normalizeAgentConfig({
    listenModel: 'flux-general-en',
    turnDetection: { eotThreshold: 5, eagerEotThreshold: 0.1, eotTimeoutMs: 999999 },
  });
  assert.deepEqual(cfg.turnDetection, { eotThreshold: 1, eagerEotThreshold: 0.3, eotTimeoutMs: 10000 });
});

test('normalizeAgentConfig is safe against non-object input', () => {
  assert.deepEqual(normalizeAgentConfig(null), DEFAULT_AGENT_CONFIG);
  assert.deepEqual(normalizeAgentConfig('garbage' as unknown), DEFAULT_AGENT_CONFIG);
});

test('greeting is only included when provided', () => {
  const withGreeting: any = buildAgentSettingsMessage({ ...DEFAULT_AGENT_CONFIG, greeting: 'Hi there!' });
  assert.equal(withGreeting.agent.greeting, 'Hi there!');
  const without: any = buildAgentSettingsMessage(DEFAULT_AGENT_CONFIG);
  assert.equal('greeting' in without.agent, false);
});

test('speak provider version follows the TTS family (flux=v2, aura=v1)', () => {
  const flux = buildAgentSettingsMessage({
    ...DEFAULT_AGENT_CONFIG,
    speakModel: 'flux-kit-en',
    speakVersion: 'v2',
  }) as any;
  assert.equal(flux.agent.speak.provider.version, 'v2');

  // Aura voices must not be sent to the Flux (v2) TTS endpoint.
  for (const model of ['aura-asteria-en', 'aura-luna-en', 'aura-2-thalia-en']) {
    const aura = buildAgentSettingsMessage({
      ...DEFAULT_AGENT_CONFIG,
      speakModel: model,
      speakVersion: 'v2', // UI default must not leak into the payload for Aura
    }) as any;
    assert.equal(aura.agent.speak.provider.version, 'v1', model);
    assert.equal(aura.agent.speak.provider.model, model);
  }
});

test('speakProviderVersion covers unknown providers and explicit overrides', () => {
  assert.equal(speakProviderVersion('flux-kit-en'), 'v2');
  assert.equal(speakProviderVersion('aura-stella-en'), 'v1');
  assert.equal(speakProviderVersion('some_custom_voice', 'v1'), 'v1');
  assert.equal(speakProviderVersion('some_custom_voice'), 'v2');
  assert.equal(speakProviderVersion('', undefined), 'v2');
});
