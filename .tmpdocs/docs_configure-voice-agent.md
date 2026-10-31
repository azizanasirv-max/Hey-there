> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Configure the Voice Agent

To configure your Voice Agent, you'll need to send a [Settings](/docs/voice-agent-settings) message immediately after connection. This message configures the agent's behavior, input/output audio formats, and various provider settings.

> **Info**
>
> For more information on the `Settings` message, see the [Voice Agent API Reference](/reference/voice-agent/voice-agent)

> **Warning**
>
> Provider-specific guidance lives on the model pages, not here. For LLM model selection, fallback behavior, and managed-vs-BYO provider rules, see [LLM Models](/docs/voice-agent-llm-models). For TTS provider parameters and codeswitching voices, see [TTS Models](/docs/voice-agent-tts-models). For audio encoding choices, see [Media Inputs & Outputs](/docs/voice-agent-media-inputs-outputs).

## Settings Overview

The `Settings` message is a JSON object that contains the following fields:

### Settings

| Parameter       | Type    | Description                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------- |
| `type`          | String  | Must be "Settings" to indicate this is a settings configuration message         |
| `tags`          | Array   | Tags to associate with the request for filtered searching. Each tag is a string |
| `experimental`  | Boolean | Enables experimental features. Defaults to `false`                              |
| `mip_opt_out`   | Boolean | Opts out of MIP (Model Improvement Partnership Program). Defaults to `false`    |
| `flags.history` | Boolean | Defaults to `true`. Set to `false` to disable function call history.            |

### Audio

| Parameter                  | Type    | Description                                                     |
| -------------------------- | ------- | --------------------------------------------------------------- |
| `audio.input`              | Object  | The speech-to-text audio media input configuration              |
| `audio.input.encoding`     | String  | The encoding format for the input audio. Defaults to `linear16` |
| `audio.input.sample_rate`  | Integer | The sample rate in Hz for the input audio. Defaults to 16000    |
| `audio.output`             | Object  | The text-to-speech audio media output configuration             |
| `audio.output.encoding`    | String  | The encoding format for the output audio                        |
| `audio.output.sample_rate` | Integer | The sample rate in Hz for the output audio                      |
| `audio.output.bitrate`     | Integer | The bitrate in bits per second for the output audio             |
| `audio.output.container`   | String  | The container format for the output audio. Defaults to `none`   |

### Agent Settings

| Parameter                | Type   | Description                                                                                                                                               |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.language`         | String | **Deprecated.** Optional language code for the agent. Defaults to `en`. Use `agent.listen.provider.language` and `agent.speak.provider.language` instead. |
| `agent.context`          | Object | Optional conversation context including history of messages and function calls                                                                            |
| `agent.context.messages` | Array  | Array of previous conversation messages and function calls to provide context to the agent                                                                |
| `agent.greeting`         | String | Optional initial message that the agent will speak when the conversation starts                                                                           |

#### `agent.context`

* The `agent.context` object allows you to provide conversation history to the agent when starting a new session. This is useful for continuing conversations or providing background context.
* The `agent.context.messages` array contains conversation history entries, which can be either conversational messages or function calls.
* **Conversational messages** have the format: `{"type": "History", "role": "user" | "assistant", "content": "message text"}`
* **Function call messages** have the format: `{"type": "History", "function_calls": [{"id": "unique_id", "name": "function_name", "client_side": true/false, "arguments": "json_string", "response": "response_text"}]}`
* Use this feature to maintain conversation continuity across sessions or to provide the agent with relevant background information.
* To disable function call history, set `settings.flags.history` to `false` in the `Settings` message.

### Agent - Listen Settings (STT)

| Parameter                                   | Type    | Description                                                                                                                                                                                                 |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.listen.provider.type`                | Object  | The speech-to-text provider type. Currently only Deepgram is supported                                                                                                                                      |
| `agent.listen.provider.model`               | String  | The [Deepgram speech-to-text model](/docs/models-languages-overview) to be used                                                                                                                             |
| `agent.listen.provider.version`             | String  | The Deepgram speech-to-text API version. Flux models use `v2` and all other models use `v1`.                                                                                                                |
| `agent.listen.provider.language`            | String  | Optional [Deepgram speech-to-text language](/docs/language) to be used for transcription. Flux models automatically leverage the language within the model's name, and Nova models default to `en`.         |
| `agent.listen.provider.keyterms`            | Array   | The [Keyterms](/docs/keyterm) you want increased recognition for. Each entry is a plain string with no weights or intensifiers; pass a multi-word phrase as a single array element.                         |
| `agent.listen.provider.eot_threshold`       | Number  | Confidence threshold for [end-of-turn detection](/docs/flux/configuration#parameter-details). Valid range: `0.5` - `1.0`. Defaults to `0.7`. Flux models only.                                              |
| `agent.listen.provider.eager_eot_threshold` | Number  | Confidence threshold for [eager end-of-turn detection](/docs/flux/configuration#parameter-details). Valid range: `0.3` - `0.9`. Flux models only.                                                           |
| `agent.listen.provider.eot_timeout_ms`      | Integer | Time in milliseconds after speech to finish a turn regardless of EOT confidence. Defaults to `5000`. Flux models only.                                                                                      |
| `agent.listen.provider.language_hints`      | Array   | Array of one or more BCP-47 language codes to bias toward specific languages. See [supported languages](/docs/flux/language-prompting#supported-languages). Only supported when using `flux-general-multi`. |
| `agent.listen.provider.smart_format`        | Boolean | Applies smart formatting to improve transcript readability (Deepgram providers only). Defaults to `false`                                                                                                   |

#### `agent.listen.provider.model`

* To use Flux use `flux-general-en`, or `flux-general-multi` for multilingual support.
* When using `flux-general-multi`, set `agent.listen.provider.language_hints` to an array of BCP-47 language codes to bias toward expected languages. See [Flux Multilingual & Language Prompting](/docs/flux/language-prompting).
* Refer to the [language availability](/docs/models-languages-overview#flux) for Flux to understand the language options.

#### `agent.listen.provider.language`

* Choose your language parameters based on your use case:
  * If you know your input language, specify it directly in `agent.listen.provider.language` for the best recognition accuracy.
  * If you expect multiple languages or are unsure, use `multi` in `agent.listen.provider.language` for flexible language support (Nova models), or use `flux-general-multi` with `language_hints` for Flux-based multilingual support.

* Refer to our [supported languages](/docs/models-languages-overview) to ensure you're using the correct model (Flux, Nova-3, or Nova-2) for your selected language.

* For detailed multilingual setup, see [Multilingual Voice Agents](/docs/multilingual-voice-agent).

#### `agent.listen.provider.keyterms`

* Each entry in the `keyterms` array is a plain term or phrase—for example, `"keyterms": ["hello", "customer service"]`.
* [Keyterm Prompting](/docs/keyterm) does **not** support the weight/intensifier syntax from the legacy [Keywords](/docs/keywords) feature. Do not append a weight such as `"term:0.15"`; it is not rejected, but the weight is silently ignored and the whole string is treated as a literal keyterm.
* Pass a multi-word phrase as a single array element (for example, `["customer service"]`), not as separate words.

#### `agent.listen.provider.eot_threshold`, `agent.listen.provider.eager_eot_threshold`, and `agent.listen.provider.eot_timeout_ms`

These parameters control [Flux end-of-turn detection](/docs/flux/configuration#parameter-details) and are only available when using Flux models with the v2 API (`agent.listen.provider.version` set to `v2`).

* `eot_threshold` sets the confidence required to trigger an `EndOfTurn` event. Higher values reduce false positives but increase latency. Defaults to `0.7`. Set it to `1.0` to fully suppress natural end-of-turn detection and own turn taking with [`ForceEndTurn`](/docs/voice-agent-force-end-turn).
* `eager_eot_threshold` enables eager end-of-turn detection, triggering `EagerEndOfTurn` events before the user fully finishes speaking. This reduces end-to-end latency but increases LLM calls. Must be less than or equal to `eot_threshold`.
* `eot_timeout_ms` sets a hard timeout in milliseconds — a turn finishes when this much time has passed after speech, regardless of EOT confidence. Defaults to `5000`.
* All three parameters can be updated during a conversation using the [`UpdateListen`](/docs/voice-agent-update-listen) message.
* For detailed tuning guidance, see the [Flux end-of-turn configuration](/docs/flux/configuration).
* These thresholds also set how wide the agent's speculative window is: the agent starts thinking on an eager end-of-turn signal and releases audio on a confirmed one. See [Speculative Replies & Turn Confirmation](/docs/voice-agent-speculative-replies).

#### `agent.listen.provider.smart_format`

* The `agent.listen.provider.smart_format` setting is only available for Deepgram providers.
* When set to `true`, Deepgram applies smart formatting to improve transcript readability.
* Useful for UI-based apps that display Agent transcripts on screen, as it formats the text for better readability.
* When set to `false`, Deepgram does not apply smart formatting.
* The default value is `false`.
* When using Flux, you cannot use `smart_format`.

### Agent - Think Settings (LLM)

| Parameter                               | Type              | Description                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.think.provider.type`             | Object            | The [LLM Model](/docs/voice-agent-llm-models) provider type                                                                                                                                                                                                                                                                                           |
| `agent.think.provider.model`            | String            | The LLM model to use                                                                                                                                                                                                                                                                                                                                  |
| `agent.think.provider.version`          | String            | Optional. For the `google` provider, selects the Google API: `ai-studio-v1beta` for AI Studio or `gemini-enterprise-agent-v1` for the Gemini Enterprise Agent (GEA) API. `v1beta` is accepted as an alias for `ai-studio-v1beta`. Defaults depend on the Deepgram endpoint — see [Regional Endpoints](/reference/regional-endpoints#google-llm-apis). |
| `agent.think.provider.temperature`      | Number            | Controls the randomness of the LLM's output. Range: 0-2 for OpenAI (4.0-4.1 model families), Google, Groq, 0-1 for Anthropic, model dependent for AWS Bedrock.                                                                                                                                                                                        |
| `agent.think.provider.reasoning_mode`   | String            | Optional. Controls the reasoning effort for supported OpenAI reasoning models (5.0 model family and later). Accepts `low`, `medium`, or `high`.                                                                                                                                                                                                       |
| `agent.think.provider.credentials`      | Object            | Optional credentials for AWS Bedrock provider. When present, must include `type`, `region`, `access_key_id`, and `secret_access_key`. If `type` is "sts", also include `session_token`                                                                                                                                                                |
| `agent.think.endpoint`                  | Object            | Optional if LLM provider is open_ai or anthropic. Required for 3rd party LLM providers such as google, groq, and aws_bedrock.  When present, must include `url` field and `headers` object                                                                                                                                                            |
| `agent.think.functions`                 | Array             | Array of functions the agent can call during the conversation                                                                                                                                                                                                                                                                                         |
| `agent.think.functions.endpoint`        | Object            | The Function endpoint to call. if not passed, function is called client-side                                                                                                                                                                                                                                                                          |
| `agent.think.functions.defer_until_eot` | Boolean           | Optional. When `true`, this function is held until the user's turn is confirmed instead of dispatching speculatively. Defaults to `false`                                                                                                                                                                                                             |
| `agent.think.prompt`                    | String            | The system prompt that defines the agent's behavior and personality. Limit of 25,000 characters for managed LLMs and unlimited for BYO LLMs.                                                                                                                                                                                                          |
| `agent.think.context_length`            | Integer or String | Specifies the number of characters retained in context between user messages, agent responses, and function calls. This setting is only configurable when a custom think endpoint is used. Use `max` for maximum context length.                                                                                                                      |

#### `agent.think.functions.defer_until_eot`

The agent starts building a reply before speech-to-text confirms the user has finished speaking. Agent audio waits for that confirmation. Function calls do not: by default a call dispatches as soon as the LLM emits it, which is where much of the agent's latency advantage comes from.

Set `defer_until_eot` to `true` on a function whose side effect cannot be undone, such as ending a call, booking an appointment, or charging a card.

* The call is held through the speculative window and dispatched once the turn is confirmed.
* If the user keeps speaking and the turn resumes, the call is discarded before it runs.
* The default is `false`, so agents that do not set it behave exactly as before.
* Deferring one function does not delay the others. A function that did not opt in still dispatches immediately, even when a deferred call is queued ahead of it in the same turn, so calls within a turn can complete out of order.
* An unrecognized function name never defers, so a call to a function you did not define still returns its usual error.
* This applies to every listen provider, not only Flux, and produces no warning on any of them.
* When `eot_timeout_ms` ends the turn, the turn counts as confirmed and a deferred call dispatches. A deferred call is not dropped for want of a confident end-of-turn signal.
* With `eot_threshold` set to `1.0`, natural end-of-turn detection is suppressed, so a deferred call waits for [`ForceEndTurn`](/docs/voice-agent-force-end-turn).

```json
{
  "name": "end_call",
  "description": "End the conversation and close the connection",
  "parameters": { "type": "object", "properties": {} },
  "defer_until_eot": true
}
```

`defer_until_eot` is a property of the function definition in `Settings`. It does not appear on the [`FunctionCallRequest`](/docs/voice-agent-function-call-request) message.

For the full picture of what the agent does before a turn is confirmed, see [Speculative Replies & Turn Confirmation](/docs/voice-agent-speculative-replies).

#### `agent.think.provider.reasoning_mode`

* The `reasoning_mode` parameter maps to OpenAI's [`reasoning_effort`](https://platform.openai.com/docs/api-reference/chat/create#chat_create-reasoning_effort) parameter.
* Accepts `low`, `medium`, or `high`. Higher values allow the model to spend more tokens reasoning before responding, which can improve accuracy on complex tasks.
* Only supported with OpenAI reasoning models (e.g., `gpt-5`, `gpt-5-mini`).

#### `agent.think.context_length`

* Using `max` will set the context length to the maximum allowed based on the LLM provider you use. If the total context exceeds the model's maximum, truncation is handled by the LLM provider.
* Increasing the context length may help preserve multi-turn conversation history, especially when verbose function calls inflate the total context.
* All characters sent to the LLM count toward the context limit, including fully serialized JSON messages, function call arguments, and responses. System messages are excluded and managed separately via `agent.think.prompt`.
* The default context length set by Deepgram is optimized for cost and latency. It is not recommended to change this setting unless there's a clear need.

### Agent - Speak Settings (TTS)

| Parameter                           | Type             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.speak.provider.type`         | Object           | The [TTS Model](/docs/voice-agent-tts-models) provider type. e.g., `deepgram`, `eleven_labs`, `cartesia`, `open_ai`, `aws_polly`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `agent.speak.provider.version`      | String           | The Deepgram text-to-speech model family. [Flux TTS](/docs/flux-tts/overview) models use `v2` and Aura models use `v1`. Defaults to `v1` when omitted. Deepgram providers only.                                                                                                                                                                                                                                                                                                                                                                                  |
| `agent.speak.provider.model`        | String           | The [TTS Model](/docs/voice-agent-tts-models)  to use for Deepgram or OpenAI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `agent.speak.provider.model_id`     | String           | The [TTS Model](/docs/voice-agent-tts-models) ID to use for Eleven Labs or Cartesia                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `agent.speak.provider.voice`        | Object or String | Voice configuration. For Cartesia: use object with `mode` and `id`. For OpenAI: use a string value.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `agent.speak.provider.speed`        | Float or String  | Speaking rate control for Deepgram and Cartesia TTS, defaulting to `1.0`. For Aura (`provider.version` `v1`): any float between `0.7` and `1.5`. For [Flux TTS](/docs/flux-tts/overview) (`provider.version` `v2`): `0.5` to `1.5` in `0.05` increments. For Cartesia: accepts `slowest`, `slow`, `normal`, `fast`, `fastest`, or a numerical value for granular control. See [TTS voice controls](/docs/tts-voice-controls#parameters) and [Cartesia speed documentation](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion). |
| `agent.speak.provider.expressivity` | Integer          | Optional delivery register for [Flux TTS](/docs/flux-tts/overview) (`provider.version` `v2`), on a calm to animated axis. Accepts the whole numbers `-2` to `2`, defaulting to `0` (the voice's tuned delivery). Beta. See [Expressivity](/docs/tts-expressivity).                                                                                                                                                                                                                                                                                               |
| `agent.speak.provider.volume`       | Number           | Optional volume level for Cartesia TTS. Range: `0.5` - `2.0`. See [Cartesia volume, speed, and emotion](https://docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion#volume-speed-and-emotion).                                                                                                                                                                                                                                                                                                                                                     |
| `agent.speak.provider.language`     | String           | Optional language setting for Cartesia and Eleven Labs providers. Maps to Eleven Labs `language_code`. Deepgram voices carry their language in the model name (e.g. `flux-kit-en`, `aura-2-sirio-es`) and reject a `language` field with `UNPARSABLE_CLIENT_MESSAGE`.                                                                                                                                                                                                                                                                                            |
| `agent.speak.provider.engine`       | String           | Optional engine for Amazon (AWS) Polly provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `agent.speak.provider.credentials`  | Object           | Optional credentials for Amazon (AWS) Polly provider. When present, must include  `type`,`region`, `access_key_id`, `secret_access_key` and `session_token` if STS is used                                                                                                                                                                                                                                                                                                                                                                                       |
| `agent.speak.endpoint`              | Object           | Optional if TTS provider is Deepgram. Required for non-Deepgram TTS providers. When present, must include `url` field and `headers` object                                                                                                                                                                                                                                                                                                                                                                                                                       |

#### `agent.speak.provider.version`

* Applies to Deepgram TTS providers only. Selects the Deepgram text-to-speech model family.
* Set `v2` to use [Flux TTS](/docs/flux-tts/overview) with a `flux-{voice}-{language}` model such as `flux-alexis-en`.
* Set `v1` (the default when omitted) to use [Aura](/docs/tts-models) models such as `aura-2-thalia-en`.
* Flux TTS voices are served only on `v2` and Aura voices only on `v1`, so change `version` and `model` together.
* Flux TTS is the default when `agent.speak` is omitted, using the `flux-kit-en` voice. It streams raw audio only — see [TTS Models](/docs/voice-agent-tts-models#audio-output-formats) for the `audio.output` formats it accepts.

#### `agent.speak.provider.language`

* Currently, `multi` is only supported in `agent.speak.provider.language` with [Eleven Labs TTS](/docs/voice-agent-tts-models#eleven-labs), [OpenAI TTS](/docs/voice-agent-tts-models#eleven-labs), or [Cartesia TTS](/docs/voice-agent-tts-models#cartesia).
* Refer to our [supported languages](/docs/models-languages-overview) to ensure you're using the correct model (Flux, Nova-3, or Nova-2) for your selected language.
* For detailed multilingual setup, see [Multilingual Voice Agents](/docs/multilingual-voice-agent).

#### `agent.speak.provider.expressivity`

* Applies to Deepgram Flux TTS only (`provider.version` `v2`), where every Flux voice supports it. It is not available on Aura (`v1`) or third-party providers.
* Negative values produce calmer, steadier delivery; positive values produce more animated delivery with a wider pitch range. `0` is the voice's tuned default and the only value validated for production.
* Set it in the `Settings` message; the value applies for the whole session.
* `expressivity` is a beta parameter, and non-default values raise the risk of hallucinations and pronunciation errors. Test the value you plan to ship.
* For value-by-value guidance and use case recommendations, see [Expressivity](/docs/tts-expressivity).

#### TTS Controls - Speed, Pronounciation, Pause / Pacing

* Use `agent.speak.provider.speed` to control speed for each session
* Use `agent.speak.provider.expressivity` to control the delivery register of a Flux TTS voice for each session
* Leverage the prompt (`agent.think.prompt`) for pronunciation, pause, and pacing controls. For detailed recommendations, see [Voice Agent TTS Controls](/docs/voice-agent-tts-controls).

## Full Example

Below is an in-depth example of a complete `Settings` message. Every field shown is valid together, and the message parses as-is against the live API. Options that require provider-specific or account-specific values live on their own pages:

* Third-party and BYO `speak` providers (Cartesia, Eleven Labs, OpenAI, AWS Polly, custom endpoints): [TTS Models](/docs/voice-agent-tts-models)
* BYO LLM `think.endpoint`: [LLM Models](/docs/voice-agent-llm-models). `context_length` is documented under `agent.think.context_length` above and is only configurable with a custom `think.endpoint`.
* Server-side functions add an `endpoint` object to the function (the function below is client-side); see `agent.think.functions.endpoint` in the parameter table above and the snippet after the example. For the call flow, see [Build a Function Call](/docs/build-a-function-call).

  **`JSON`**

  ```json JSON
  {
    "type": "Settings",
    "tags": ["order", "customer_service"],
    "experimental": false,
    "mip_opt_out": false,
    "flags": {
      "history": true
    },
    "audio": {
      "input": {
        "encoding": "linear16",
        "sample_rate": 24000
      },
      "output": {
        "encoding": "linear16",
        "sample_rate": 24000,
        "container": "none"
      }
    },
    "agent": {
      "context": {
        "messages": [
          {
            "type": "History",
            "role": "user",
            "content": "What's my order status?"
          },
          {
            "type": "History",
            "function_calls": [
              {
                "id": "fc_12345678-90ab-cdef-1234-567890abcdef",
                "name": "check_order_status",
                "client_side": true,
                "arguments": "{\"order_id\": \"ORD-123456\"}",
                "response": "Order #123456 status: Shipped - Expected delivery date: 2024-03-15"
              }
            ]
          },
          {
            "type": "History",
            "role": "assistant",
            "content": "Your order #123456 has been shipped and is expected to arrive on March 15th, 2024."
          }
        ]
      },
      "listen": {
        "provider": {
          "type": "deepgram",
          "model": "flux-general-en",
          "version": "v2",
          "keyterms": ["hello", "goodbye"],
          "eot_threshold": 0.8,
          "eager_eot_threshold": 0.5,
          "eot_timeout_ms": 5000
        }
      },
      "think": {
        "provider": {
          "type": "open_ai",
          "model": "gpt-5-mini",
          "reasoning_mode": "medium"
        },
        "prompt": "You are a helpful AI assistant focused on customer service.",
        "functions": [
          {
            "name": "check_order_status",
            "description": "Check the status of a customer order",
            "parameters": {
              "type": "object",
              "properties": {
                "order_id": {
                  "type": "string",
                  "description": "The order ID to check"
                }
              },
              "required": ["order_id"]
            }
          }
        ]
      },
      "speak": {
        "provider": {
          "type": "deepgram",
          "version": "v2",
          "model": "flux-kit-en",
          "speed": 1.0
        }
      },
      "greeting": "Hello! How can I help you today?"
    }
  }
  ```

The function above runs client-side: your application receives the [Function Call Request](/docs/voice-agent-function-call-request) and returns the result. To have Deepgram call the function server-side instead, add an `endpoint` object to it. The server resolves the URL when it applies `Settings`, so the endpoint must be reachable:

**`JSON`**

```json JSON
{
  "name": "check_order_status",
  "description": "Check the status of a customer order",
  "parameters": {
    "type": "object",
    "properties": {
      "order_id": {
        "type": "string",
        "description": "The order ID to check"
      }
    },
    "required": ["order_id"]
  },
  "endpoint": {
    "url": "https://api.example.com/orders/status",
    "method": "post",
    "headers": {
      "authorization": "Bearer {{token}}"
    }
  }
}
```

## Next Steps

* [Voice Agent Message Flow](/docs/voice-agent-message-flow) for the correct message flow when building a Voice Agent client.