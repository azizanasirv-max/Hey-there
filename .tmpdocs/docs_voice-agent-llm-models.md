> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# LLM Models

Defines the LLM (*Large Language Model*) to be used with your Agent. The `provider.type` field specifies the format or protocol of the API.

For example:

* `open_ai` means the API follows OpenAI's Chat Completions format.
* This option can be used with OpenAI, Azure OpenAI, or Amazon Bedrock — as long as the endpoint behaves like OpenAI's Chat Completion API.

> **Info**
>
> You can set your Voice Agent's LLM model in the [Settings Message](/docs/configure-voice-agent) See the docs for more information.

## Supported LLM providers

| Parameter                   | `deepgram` | `open_ai` | `anthropic` | `aws_bedrock` | `google` | `groq`   | `nvidia` |
| --------------------------- | ---------- | --------- | ----------- | ------------- | -------- | -------- | -------- |
| `agent.think.provider.type` | `deepgram` | `open_ai` | `anthropic` | `aws_bedrock` | `google` | `groq`   | `nvidia` |
| `agent.think.endpoint`      | omit       | optional  | optional    | required      | optional | required | optional |

The `agent.think.endpoint` is optional or required based on the provider type:

* For `deepgram`, omit `endpoint`. Deepgram hosts these models. The `deepgram` provider is in Early Access; see [Deepgram](#deepgram-early-access).
* For `open_ai`, `anthropic`, `google`, and `nvidia`, the `endpoint` field is optional because Deepgram provides managed LLMs for these providers.
* For `groq` and `aws_bedrock` provider types, `endpoint` is required because Deepgram does not manage those LLMs.
* If an `endpoint` is provided the `url` is required but `headers` are optional.

> **Info**
>
> If you don't specify `agent.think.provider.type` the Voice Agent will use Deepgram's default managed LLMs. For managed LLMs, supported model names are predefined in our configuration.

See the [Amazon Bedrock](#amazon-bedrock) section below for credentials and endpoint configuration. To fetch the current list of providers and models programmatically, see [Listing supported models via the API](#listing-supported-models-via-the-api).

## Supported LLM models

### Deepgram (Early Access)

> **Warning**
>
> **Early Access.** Deepgram LLMs are available only to current Deepgram contract customers enrolled in the Early Access program ([talk to sales](https://deepgram.com/contact-us) for access). Usage is free during Early Access, requests run on the global endpoint only, SDKs do not support the endpoint yet, and the API can change before general availability. Do not run production traffic on it.

Deepgram's own LLMs, hosted by Deepgram. Use provider type `deepgram` for every Deepgram model. See [Deepgram LLMs](/docs/llm) for model details.

| Provider   | Model                       |
| ---------- | --------------------------- |
| `deepgram` | `think-fast`                |
| `deepgram` | `phonellm-mini-alpha-2-fp8` |

Think-Fast can only be used with the Model Improvement Program. A `Settings` message that selects `think-fast` in a session opted out of MIP (`mip_opt_out: true` at the top level of `Settings`, or a project that requires opt-out) is rejected with `INVALID_SETTINGS`. Use `phonellm-mini-alpha-2-fp8` for sessions that opt out. See [Data retention and MIP](/docs/llm/data-retention).

With `think-fast`, Deepgram places instructions on spoken response style ahead of your prompt and sends a `VOICE_PROMPT_ADDED` warning. Set `agent.think.provider.voice_prompt_opt_out` to `true` to send your prompt unchanged. See [Use in the Voice Agent](/docs/llm/voice-agent#voice-style-instructions).

#### Example using a Deepgram LLM

**`JSON`**

```json JSON
{
  "type": "Settings",
  "agent": {
    "think": {
      "provider": {
        "type": "deepgram",
        "model": "think-fast",
        "temperature": 0.7
      }
    }
  }
}
```

### OpenAI

| Provider  | Model                 | Pricing Tier |
| --------- | --------------------- | ------------ |
| `open_ai` | `gpt-5.6-terra`       | `Advanced`   |
| `open_ai` | `gpt-5.6-luna`        | `Standard`   |
| `open_ai` | `gpt-5.5`             | `Advanced`   |
| `open_ai` | `gpt-5.4-nano`        | `Standard`   |
| `open_ai` | `gpt-5.4-mini`        | `Standard`   |
| `open_ai` | `gpt-5.4`             | `Advanced`   |
| `open_ai` | `gpt-5.3-chat-latest` | `Advanced`   |
| `open_ai` | `gpt-5.2-chat-latest` | `Advanced`   |
| `open_ai` | `gpt-5.2`             | `Advanced`   |
| `open_ai` | `gpt-5.1-chat-latest` | `Advanced`   |
| `open_ai` | `gpt-5.1`             | `Advanced`   |
| `open_ai` | `gpt-5-nano`          | `Standard`   |
| `open_ai` | `gpt-5-mini`          | `Standard`   |
| `open_ai` | `gpt-5`               | `Advanced`   |
| `open_ai` | `gpt-4.1-nano`        | `Standard`   |
| `open_ai` | `gpt-4.1-mini`        | `Standard`   |
| `open_ai` | `gpt-4.1`             | `Advanced`   |
| `open_ai` | `gpt-4o-mini`         | `Standard`   |
| `open_ai` | `gpt-4o`              | `Advanced`   |

#### Example using Deepgram's managed OpenAI LLM

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "open_ai",
      "model": "gpt-4o-mini",
      "temperature": 0.5
    }
  }
  // ... other settings ...
```

#### Example using a custom OpenAI endpoint (BYO)

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "open_ai",
      "model": "gpt-4o-mini",
      "temperature": 0.5
    },
    "endpoint": {
      "url": "https://api.openai.com/v1/chat/completions",
      "headers": {
        "authorization": "Bearer xxxxxxxxx"
      }
    }
  }
  // ... other settings ...
```

### Anthropic

| Provider    | Model                      | Pricing Tier            |
| ----------- | -------------------------- | ----------------------- |
| `anthropic` | `claude-sonnet-5`          | `Advanced`              |
| `anthropic` | `claude-sonnet-4-6`        | `Advanced`              |
| `anthropic` | `claude-sonnet-4-5`        | `Advanced`              |
| `anthropic` | `claude-haiku-4-5`         | `Standard`              |
| `anthropic` | `claude-3-5-haiku-latest`  | `Standard`              |
| `anthropic` | `claude-sonnet-4-20250514` | `Advanced` (Deprecated) |

#### Example using Deepgram's managed Anthropic LLM

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "anthropic",
      "model": "claude-haiku-4-5",
      "temperature": 0.5
    }
  }
  // ... other settings ...
```

#### Example using a custom Anthropic endpoint (BYO)

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "anthropic",
      "model": "claude-haiku-4-5",
      "temperature": 0.5
    },
    "endpoint": {
      "url": "https://api.anthropic.com/v1/messages",
      "headers": {
        "x-api-key": "xxxxxxxxx",
        "anthropic-version": "2023-06-01"
      }
    }
  }
  // ... other settings ...
```

### Google

| Provider | Model                           | Pricing Tier                         |
| -------- | ------------------------------- | ------------------------------------ |
| `google` | `gemini-3.5-flash`              | `Standard`                           |
| `google` | `gemini-3.1-flash-lite`         | `Standard`                           |
| `google` | `gemini-3.1-flash-lite-preview` | `Standard` (Deprecated May 26, 2025) |
| `google` | `gemini-3-flash-preview`        | `Standard`                           |
| `google` | `gemini-3-pro-preview`          | `Advanced`                           |
| `google` | `gemini-2.5-flash`              | `Standard`                           |
| `google` | `gemini-2.0-flash-lite`         | `Standard`                           |

Deepgram supports both of Google's APIs for managed Gemini models: the AI Studio API and the Gemini Enterprise Agent (GEA) API, formerly the Vertex API. GEA offers regional endpoints, so requests can stay in the region you select, while global AI Studio offers the broadest model coverage. You can specify either API from any Deepgram Voice Agent endpoint using the `think.provider.version` parameter; the default depends on which Deepgram endpoint you connect to.

| `think.provider.version`     | Google API                               |
| ---------------------------- | ---------------------------------------- |
| `ai-studio-v1beta`           | AI Studio                                |
| `gemini-enterprise-agent-v1` | Gemini Enterprise Agent (GEA)            |
| `v1beta`                     | AI Studio — alias for `ai-studio-v1beta` |

For defaults, regional availability, and configuration details, see [Regional Endpoints](/reference/regional-endpoints#google-llm-apis).

#### Example using Deepgram's managed Google LLM

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "google",
      "version": "ai-studio-v1beta",
      "model": "gemini-2.5-flash",
      "temperature": 0.5
    }
  }
  // ... other settings ...
```

#### Example using a custom Google endpoint (BYO)

When using a custom endpoint, the `model` property is not supported.
The desired model is specified as part of the endpoint URL instead.

> **Info**
>
> Use [API keys](https://ai.google.dev/gemini-api/docs/api-key) from [Google AI Studio](https://aistudio.google.com/app/api-keys) for Gemini models. Keys from Vertex AI, Workspace Gemini, or Gemini Enterprise will not work with the Agent API.

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "google",
      "temperature": 0.5
    },
    "endpoint": {
      "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      "headers": {
        "x-goog-api-key": "xxxxxxxxx"
      }
    }
  }
  // ... other settings ...
```

### NVIDIA

| Provider | Model                     | Pricing Tier |
| -------- | ------------------------- | ------------ |
| `nvidia` | `nemotron-3-nano-30B-A3B` | `Standard`   |

#### Example using Deepgram's managed NVIDIA LLM

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "nvidia",
      "model": "nemotron-3-nano-30B-A3B",
      "temperature": 0.5
    }
  }
  // ... other settings ...
```

### Groq

| Provider | Model                | Pricing Tier |
| -------- | -------------------- | ------------ |
| `groq`   | `openai/gpt-oss-20b` | `Standard`   |

### Amazon Bedrock

Amazon Bedrock is a BYO provider. Deepgram does not host Bedrock models, so `endpoint.url` is required and you supply your own AWS credentials. Bedrock model IDs (for example `us.anthropic.claude-3-5-sonnet-20241022-v2:0`) are passed through to Bedrock as-is.

| Parameter                          | Value                                             |
| ---------------------------------- | ------------------------------------------------- |
| `agent.think.provider.type`        | `aws_bedrock`                                     |
| `agent.think.provider.model`       | A Bedrock model ID                                |
| `agent.think.provider.credentials` | IAM or STS credentials (see below)                |
| `agent.think.endpoint.url`         | `https://bedrock-runtime.{region}.amazonaws.com/` |

#### IAM credentials

Use long-lived IAM access keys when your application has stable credentials.

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "aws_bedrock",
      "model": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      "temperature": 0.7,
      "credentials": {
        "type": "iam",
        "region": "us-east-2",
        "access_key_id": "{{your_access_key_id}}",
        "secret_access_key": "{{your_secret_access_key}}"
      }
    },
    "endpoint": {
      "url": "https://bedrock-runtime.us-east-2.amazonaws.com/"
    }
  }
  // ... other settings ...
```

#### STS (temporary) credentials

Use STS credentials when your application assumes a role and rotates tokens. Add the `session_token` returned by your STS call.

**`JSON`**

```json JSON
  // ... other settings ...
  "think": {
    "provider": {
      "type": "aws_bedrock",
      "model": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      "temperature": 0.7,
      "credentials": {
        "type": "sts",
        "region": "us-east-2",
        "access_key_id": "{{your_temporary_access_key_id}}",
        "secret_access_key": "{{your_temporary_secret_access_key}}",
        "session_token": "{{your_session_token}}"
      }
    },
    "endpoint": {
      "url": "https://bedrock-runtime.us-east-2.amazonaws.com/"
    }
  }
  // ... other settings ...
```

> **Warning**
>
> AWS credentials must have permission to invoke Bedrock models, and the endpoint URL must match the region the Bedrock model is hosted in.

If you need an OpenAI-compatible proxy in front of Bedrock (for logging, header rewriting, or use of the Bedrock Agents service), see [Passing a custom (BYO) LLM through a Cloud Provider](#passing-a-custom-byo-llm-through-a-cloud-provider) below.

## Example Payload

**`JSON`**

```json JSON
// ... other settings ...
 "think": {
      "provider": {
        "type": "open_ai",
        "model": "gpt-4o-mini",
        "temperature": 0.7
      },
      "endpoint": { // Optional if LLM provider is open_ai, anthropic, or google. Required for 3rd party LLM providers such as groq
        "url": "https://api.example.com/llm", // Required if endpoint is provided
        "headers": { // Optional if an endpoint is provided
          "authorization": "Bearer {{token}}"
        }
      },
    }
// ... other settings ...
```

## Passing a custom (BYO) LLM through a Cloud Provider

> **Info**
>
> For Bring Your Own (BYO) LLMs, any model string provided is accepted without restriction.

Deepgram tests against major LLM providers including OpenAI, Anthropic, and Google. When bringing your own LLM, you have two options:

* **Use an OpenAI-compatible LLM service or gateway.** Set `provider.type` to `open_ai` and point the `endpoint.url` to your service. Any LLM endpoint that conforms to the OpenAI Chat Completions API format will work, including third-party LLM gateways.
* **Use a custom endpoint from one of the supported major LLM providers.** If you have your own contract or deployment with a supported provider (such as OpenAI, Anthropic, or Google), set the `provider.type` to match that provider and supply your own `endpoint.url` and `endpoint.headers`.

In both cases, configure the `provider.type` to one of the supported provider values and set the `endpoint.url` and `endpoint.headers` fields to the correct values for your provider or gateway.

**`JSON`**

```json JSON
  // ... other settings ...
"think": {
      "provider": {
        "type": "open_ai",
        "model": "gpt-4",
        "temperature": 0.7
      },
      "endpoint": { // Required for a custom LLM
        "url": "https://cloud.provider.com/llm", // Required for a custom LLM
        "headers": { // Optional for a custom LLM
          "authorization": "Bearer {{token}}"
        }
      },
    }
  // ... other settings ...
```

## Using multiple LLM providers

The `think` object accepts both a single provider and an array of providers. When you supply an array, the Voice Agent uses the providers as an ordered fallback chain: it sends each LLM request to the first provider in the list and automatically falls back to the next provider if the request fails.

### How fallback works

1. The agent sends the request to the **first** provider in the array.
2. If that provider returns an error or times out, the agent sends a [`THINK_REQUEST_FAILED`](/docs/voice-agent-errors-warnings#warning) warning over the WebSocket and retries with the **next** provider.
3. This continues through every provider in the array.
4. If **all** providers fail, the agent sends a [`FAILED_TO_THINK`](/docs/voice-agent-errors-warnings#error) error and the turn produces no LLM response.

The fallback is per-request — each new conversational turn starts again from the first provider. Provider order matters, so place your preferred provider first and your most reliable fallback last.

> **Info**
>
> Fallback providers do not need to use the same `provider.type`. You can mix providers (for example, `open_ai` primary with an `anthropic` fallback) to maximize availability across independent infrastructure.

### Example

**`JSON`**

```json JSON
{
  "agent": {
    "think": [
      {
        "provider": {
          "type": "open_ai",
          "model": "gpt-4o-mini",
          "temperature": 0.7
        }
      },
      {
        "provider": {
          "type": "anthropic",
          "model": "claude-haiku-4-5",
          "temperature": 0.7
        }
      }
    ]
  }
}
```

## Listing supported models via the API

The current list of providers and models is exposed by a public API endpoint. Query it whenever you need to discover which model IDs are valid for which provider, or to programmatically build a model picker.

### Request

GET [https://agent.deepgram.com/v1/agent/settings/think/models](https://agent.deepgram.com/v1/agent/settings/think/models)

**`List supported models`**

```curl List supported models
curl https://agent.deepgram.com/v1/agent/settings/think/models

```

**`List supported models`**

```python List supported models
import requests

url = "https://agent.deepgram.com/v1/agent/settings/think/models"
response = requests.get(url)

print(response.json())

```

**`List supported models`**

```typescript List supported models
const res = await fetch(
  "https://agent.deepgram.com/v1/agent/settings/think/models",
);
const data = await res.json();
console.log(data);

```

```go
package main

import (
	"fmt"
	"net/http"
	"io"
)

func main() {

	url := "https://agent.deepgram.com/v1/agent/settings/think/models"

	req, _ := http.NewRequest("GET", url, nil)

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://agent.deepgram.com/v1/agent/settings/think/models")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Get.new(url)

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.get("https://agent.deepgram.com/v1/agent/settings/think/models")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('GET', 'https://agent.deepgram.com/v1/agent/settings/think/models');

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://agent.deepgram.com/v1/agent/settings/think/models");
var request = new RestRequest(Method.GET);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let request = NSMutableURLRequest(url: NSURL(string: "https://agent.deepgram.com/v1/agent/settings/think/models")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "GET"

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```

### Response (200)

```json
{
  "models": [
    {
      "id": "gpt-5",
      "name": "GPT-5",
      "provider": "open_ai"
    }
  ]
}
```