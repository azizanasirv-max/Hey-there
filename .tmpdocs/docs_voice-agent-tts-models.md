> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# TTS Models

By default [Deepgram Text-to-Speech](/docs/tts-models) will be used with the Voice Agent API. Deepgram supports two text-to-speech model families, and the agent picks the right TTS endpoint based on the `version` field of `agent.speak.provider` — you do not manage endpoint URLs yourself.

* **[Flux TTS](/docs/flux-tts/overview)** (`v2`) for streaming-first, voice-agent-first synthesis with turn-based lifecycle and cross-turn voice consistency.
* **[Aura](/docs/tts-models)** (`v1`) for the broadest Deepgram voice catalog across English and Spanish, and for compressed or containerized output formats.

You can also use Deepgram's native Cartesia support or opt to use another provider's TTS model with your Agent by applying the following settings.

> **Info**
>
> You can set your Text-to-Speech model in the [Settings Message](/docs/configure-voice-agent) for your Voice Agent. See the docs for more information.

## Deepgram TTS models

Deepgram offers two TTS model families for the Voice Agent API. Set `agent.speak.provider.version` to `v2` for Flux TTS or `v1` for Aura; within a provider you supply, `version` defaults to `v1`. A `Settings` message that omits `agent.speak` altogether gets Flux TTS with the `flux-kit-en` voice.

### Choosing a model family

|                              | Flux TTS (V2)                                     | Aura (V1)                                   |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------- |
| Best for                     | streaming-first voice agents                      | broadest voice catalog, compressed audio    |
| Turn-based lifecycle         | yes                                               | no                                          |
| Cross-turn voice consistency | yes                                               | no                                          |
| `provider.version`           | `v2` (required)                                   | `v1` (default)                              |
| Model string                 | `flux-{voice}-{language}` (e.g. `flux-alexis-en`) | `aura-2-thalia-en`, `aura-asteria-en`, etc. |

### Flux TTS

[Flux TTS](/docs/flux-tts/overview) is Deepgram's streaming-first, voice-agent-first text-to-speech model family. It brings a turn-based lifecycle and cross-turn voice consistency built for the realities of a voice agent pipeline. For details, see the [Flux TTS Feature Overview](/docs/flux-tts/feature-overview).

| Parameter                           | Type    | Description                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.speak.provider.type`         | String  | Must be `deepgram`                                                                                                                                                                                                                                                                                                                             |
| `agent.speak.provider.version`      | String  | Must be `v2`                                                                                                                                                                                                                                                                                                                                   |
| `agent.speak.provider.model`        | String  | Flux TTS model id in the format `flux-{voice}-{language}`, for example `flux-alexis-en`. The Voice Agent API currently supports the English Flux TTS voices — the Featured voices and More voices tables in the [Flux TTS voice catalog](/docs/flux-tts/voices); the other languages in the catalog are available on `/v2/speak` only for now. |
| `agent.speak.provider.speed`        | Float   | Speaking rate multiplier. Accepts `0.5` to `1.5` in `0.05` increments. Defaults to `1.0`.                                                                                                                                                                                                                                                      |
| `agent.speak.provider.expressivity` | Integer | Delivery register on a calm to animated axis, available on every Flux voice. Accepts `-2`, `-1`, `0`, `1`, or `2`. Defaults to `0`, the voice's tuned delivery. Beta — see [Expressivity](/docs/tts-expressivity).                                                                                                                             |

> **Info**
>
> Flux TTS voices are served only on `agent.speak.provider.version`: `v2`, and Aura voices only on `agent.speak.provider.version`: `v1`. Switch families by changing `agent.speak.provider.version` and `model` together.

#### Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "deepgram",
        "version": "v2",
        "model": "flux-alexis-en",
        "speed": 1.05
      }
    }
  }
}
```

#### Audio output formats

Flux TTS streams raw audio frames, so it accepts a narrower set of `audio.output` settings than Aura:

| Setting       | Accepted with Flux TTS                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encoding`    | `linear16`, `mulaw`, `alaw`                                                                                                                       |
| `container`   | `none`                                                                                                                                            |
| `sample_rate` | `8000`, `16000`, `24000`, `32000`, `44100` or `48000` for `linear16` (default `24000`); `8000` or `16000` for `mulaw` and `alaw` (default `8000`) |
| `bitrate`     | not accepted                                                                                                                                      |

Requesting a compressed encoding (`mp3`, `opus`, `flac`, `aac`) or a container such as `wav` returns `INVALID_SETTINGS`. Configure an Aura voice to use those formats.

> **Warning**
>
> Flux TTS is the default when `agent.speak` is omitted, so a session that omits it **and** requests compressed output is now rejected where it previously received Aura audio. Configure an Aura voice to keep that behavior.

### Aura

For a complete list of Deepgram Aura TTS models see [TTS Voice Selection](/docs/tts-models).

| Parameter                      | Type   | Description                                                                                                                                   |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.speak.provider.type`    | String | Must be `deepgram`                                                                                                                            |
| `agent.speak.provider.version` | String | Optional. Defaults to `v1` when omitted.                                                                                                      |
| `agent.speak.provider.model`   | String | The Aura TTS model to use, for example `aura-2-thalia-en`.                                                                                    |
| `agent.speak.provider.speed`   | Float  | Speaking rate multiplier. Range: `0.7` - `1.5`. Defaults to `1.0`. See [TTS voice controls](/docs/tts-voice-controls#parameters) for details. |

#### Example

**`JSON`**

```json JSON
{
  "speak": {
    "provider": {
      "type": "deepgram",
      "model": "aura-2-thalia-en",
      "speed": 0.9
    }
  }
}
```

## Deepgram-managed Cartesia TTS models

Deepgram also provides managed support for Cartesia TTS. For a complete list of Cartesia TTS models, visit [Cartesia's TTS Docs](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest). Cartesia is included in the [Standard pricing tier](https://deepgram.com/pricing).

| Parameter                    | Type             | Description                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.speak.provider.type`  | String           | Must be `cartesia`                                                                                                                                                                                                                                      |
| `agent.speak.provider.model` | String           | The TTS model to use                                                                                                                                                                                                                                    |
| `agent.speak.provider.speed` | String or Number | Speaking rate control. Accepts `slowest`, `slow`, `normal`, `fast`, `fastest`, or a numerical value for more granular control. See [Cartesia speed documentation](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion). |

### Example

**`JSON`**

```json JSON
{
"agent": {
  "speak": {
    "provider": {
      "type": "cartesia",
      "model_id": "sonic-2",
      "voice": {
        "mode": "id",
        "id": "a167e0f3-df7e-4d52-a9c3-f949145efdab"
      },
      "speed": "normal"
    }
  }
}
}
```

## BYO Third Party TTS models

To use a third party TTS voice, specify the TTS provider and required parameters.

### OpenAI

For OpenAI you can refer to [OpenAI's text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech#voice-options) on how to find your voice ID.

| Parameter                      | Type   | Description                               |
| ------------------------------ | ------ | ----------------------------------------- |
| `agent.speak.provider.type`    | String | Must be `open_ai`                         |
| `agent.speak.provider.model`   | String | The TTS model to use                      |
| `agent.speak.provider.voice`   | String | The voice to use                          |
| `agent.speak.endpoint`         | Object | Required and must include url and headers |
| `agent.speak.endpoint.url`     | String | Your OpenAI API endpoint URL              |
| `agent.speak.endpoint.headers` | Object | Required headers for authentication       |

#### Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "open_ai",
        "model": "tts-1",
        "voice": "alloy"
      },
      "endpoint": {
        "url": "https://api.openai.com/v1/audio/speech",
        "headers": {
          "authorization": "Bearer {{OPENAI_API_KEY}}"
        }
      }
    }
  }
}
```

### Eleven Labs

For ElevenLabs you can refer to [this article](https://help.elevenlabs.io/hc/en-us/articles/14599760033937-How-do-I-find-my-voices-ID-of-my-voices-via-the-website-and-through-the-API) on how to find your Voice ID or [use their API](https://elevenlabs.io/docs/api-reference/voices/search) to retrieve it. See their [TTS Docs](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-multi-stream-input) for more information. ElevenLabs [does not support](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-multi-stream-input) WebSocket streaming for the `eleven_v3` model - instead, use the HTTPS REST endpoint ([see example](#example-eleven_v3-via-https)).

> **Info**
>
> We support any of [ElevenLabs' Turbo 2.5](https://elevenlabs.io/docs/models#turbo-v25) voices to ensure low latency interactions

| Parameter                            | Type   | Description                       |
| ------------------------------------ | ------ | --------------------------------- |
| `agent.speak.provider.type`          | String | Must be `eleven_labs`             |
| `agent.speak.provider.model_id`      | String | The model ID to use               |
| `agent.speak.provider.language_code` | String | Optional Language code            |
| `agent.speak.endpoint`               | Object | Must include url and headers      |
| `agent.speak.endpoint.url`           | String | Your Eleven Labs API endpoint URL |
| `agent.speak.endpoint.headers`       | Object | Headers for authentication        |

#### Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "eleven_labs",
        "model_id": "eleven_turbo_v2_5",
        "language_code": "en-US"
      },
      "endpoint": {
        "url": "wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/multi-stream-input",
        "headers": {
          "xi-api-key": "{{ELEVEN_LABS_API_KEY}}"
        }
      }
    }
  }
}
```

#### Example (eleven_v3 via HTTPS)

Because `eleven_v3` does not support WebSocket streaming, use the HTTPS REST endpoint:

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "eleven_labs",
        "model_id": "eleven_v3",
        "language_code": "en-US"
      },
      "endpoint": {
        "url": "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        "headers": {
          "xi-api-key": "{{ELEVEN_LABS_API_KEY}}"
        }
      }
    }
  }
}
```

### Cartesia

For Cartesia you can [use their API](https://docs.cartesia.ai/api-reference/voices/list) to retrieve a voice ID. See their [TTS API Docs](https://docs.cartesia.ai/api-reference/tts/tts) for more information.

| Parameter                         | Type   | Description                    |
| --------------------------------- | ------ | ------------------------------ |
| `agent.speak.provider.type`       | String | Must be `cartesia`             |
| `agent.speak.provider.model_id`   | String | The model ID to use            |
| `agent.speak.provider.voice`      | Object | Cartesia Voice configuration   |
| `agent.speak.provider.voice.mode` | String | The voice mode to use          |
| `agent.speak.provider.voice.id`   | String | The voice ID to use            |
| `agent.speak.provider.language`   | String | Language setting               |
| `agent.speak.endpoint`            | Object | Must include url and headers   |
| `agent.speak.endpoint.url`        | String | Your Cartesia API endpoint URL |
| `agent.speak.endpoint.headers`    | Object | Headers for authentication     |

#### Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "cartesia",
        "model_id": "sonic-2",
        "voice": {
          "mode": "id",
          "id": "a167e0f3-df7e-4d52-a9c3-f949145efdab"
        },
        "language": "en"
      },
      "endpoint": {
        "url": "https://api.cartesia.ai/tts/bytes",
        "headers": {
          "x-api-key": "{{CARTESIA_API_KEY}}"
        }
      }
    }
  }
}
```

### Amazon (AWS) Polly

For Amazon (AWS) Polly you can refer to [this article](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html) for a list of available voices.

> **Warning**
>
> If no engine is specified, Amazon (AWS) Polly defaults to Standard. If the chosen voice doesn't support Standard, you'll get an error like: "Standard engine not supported for \{voice}." In that case, you must explicitly specify the correct engine.

| Parameter                            | Type   | Description              |
| ------------------------------------ | ------ | ------------------------ |
| `agent.speak.provider.type`          | String | Must be `aws_polly`      |
| `agent.speak.provider.language_code` | String | The language code to use |
| `agent.speak.provider.voice`         | String | The voice to use         |
| `agent.speak.provider.engine`        | String | The engine to use        |
| `agent.speak.provider.credentials`   | Object | The credentials to use   |

#### STS Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "aws_polly",
        "language_code": "en-US",
        "voice": "Matthew",
        "engine": "standard",
        "credentials": {
          "type": "sts",
          "region": "us-west-2",
          "access_key_id": "{{AWS_ACCESS_KEY_ID}}",
          "secret_access_key": "{{AWS_SECRET_ACCESS_KEY}}",
          "session_token": "{{AWS_SESSION_TOKEN}}"
        }
      },
      "endpoint": {
        "url": "https://polly.us-west-2.amazonaws.com/v1/speech"
      }
    }
  }
}
```

#### IAM Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": {
      "provider": {
        "type": "aws_polly",
        "voice": "Joanna",
        "language_code": "en-US",
        "engine": "standard",
        "credentials": {
          "type": "iam",
          "region": "us-east-2",
          "access_key_id": "{{AWS_ACCESS_KEY_ID}}",
          "secret_access_key": "{{AWS_SECRET_ACCESS_KEY}}"
        }
      },
      "endpoint": {
        "url": "https://polly.us-east-2.amazonaws.com/v1/speech"
      }
    }
  }
}
```

## Using multiple TTS providers

The `speak` object accepts both a single provider and an array of providers. When you supply an array, the Voice Agent uses the providers as an ordered fallback chain: it sends each TTS request to the first provider in the list and automatically falls back to the next provider if the request fails.

### How fallback works

1. The agent sends the request to the **first** provider in the array.
2. If that provider returns an error or times out, the agent sends a [`SPEAK_REQUEST_FAILED`](/docs/voice-agent-errors-warnings#warning) warning over the WebSocket and retries with the **next** provider.
3. This continues through every provider in the array.
4. If **all** providers fail, the agent sends a [`FAILED_TO_SPEAK`](/docs/voice-agent-errors-warnings#error) error and the turn produces no audio response.

The fallback is per-request — each new agent utterance starts again from the first provider. Provider order matters, so place your preferred provider first and your most reliable fallback last.

> **Info**
>
> Fallback providers do not need to use the same `provider.type`. You can mix providers (for example, `deepgram` primary with an `open_ai` fallback) to maximize availability across independent infrastructure.

### Example

**`JSON`**

```json JSON
{
  "agent": {
    "speak": [
      {
        "provider": {
          "type": "deepgram",
          "version": "v2",
          "model": "flux-kit-en"
        }
      },
      {
        "provider": {
          "type": "open_ai",
          "model": "tts-1",
          "voice": "shimmer"
        },
        "endpoint": {
          "url": "https://api.openai.com/v1/audio/speech",
          "headers": {
            "authorization": "Bearer {{OPENAI_API_KEY}}"
          }
        }
      }
    ]
  }
}
```

---

## What's Next

* [Configure the Voice Agent](/docs/configure-voice-agent)
* [Flux TTS Overview](/docs/flux-tts/overview)
* [Build a Flux TTS Voice Agent](/docs/flux-tts/voice-agent)
* [Aura TTS Voice Selection](/docs/tts-models)