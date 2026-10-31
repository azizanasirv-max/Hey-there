> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Settings

Voice Agent

The `Settings` message is a JSON command that serves as an initialization step, setting up both the behavior of the voice agent.

## Purpose

The `Settings` message is an initialization command that establishes both the behavior of the voice agent and the audio transmission formats before voice data is exchanged. The client should send a `Settings` message immediately after opening the websocket and before sending any audio.

> **Info**
>
> For a detailed explanation of all the options available for the `Settings` message, see our documentation on how to [Configure the Voice Agent](/docs/configure-voice-agent).

## Example Payloads

This example uses a very basic `Settings` to establish a connection. To send the `Settings` message, you need to send the following JSON message to the server:

**`JSON`**

```json JSON
{
"type": "Settings",
"tags": ["demo", "voice_agent"],
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
  "language": "en",
  "listen": {
    "provider": {
      "type": "deepgram",
      "model": "nova-3",
      "smart_format": false
    }
  },
  "think": {
    "provider": {
      "type": "open_ai",
      "model": "gpt-4o-mini",
      "temperature": 0.7
    }
  },
  "speak": {
    "provider": {
      "type": "deepgram",
      "version": "v2",
      "model": "flux-kit-en"
    }
  }
}
}
```

Upon receiving the `Settings` message, the server will process all remaining audio data and return the following [`SettingsApplied`](/docs/voice-agent-setting-applied-message) message.

**`JSON`**

```json JSON
{
    "type": "SettingsApplied"
}
```

## Next Steps

* [Voice Agent Message Flow](/docs/voice-agent-message-flow) for the correct message flow when building a Voice Agent client.