> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Conversation Text

Voice Agent

The `ConversationText` message is a JSON message that will be sent as a user interacts with the agent.

## Purpose

The `ConversationText` message facilitates real-time communication by relaying spoken statements from both the user and the assistant. This ensures that the conversation can be dynamically displayed on the client side, enhancing transparency and providing a clear, synchronized view of the interaction as it unfolds.

## Example Payload

The server will send a `ConversationText` message every time the agent hears the user say something, and every time the agent speaks something. These can be used on the client side to display the conversation messages as they happen in real-time.

**`JSON`**

```json JSON
{
  "type": "ConversationText",
  "role": "", // The speaker of this statement, either "user" or "assistant"
  "conversational_behavior": "", // What kind of utterance this is
  "content": "" // The statement that was spoken
}
```

## `conversational_behavior`

Every `ConversationText` message carries a `conversational_behavior` field annotating what kind of utterance it represents.

| Value            | Meaning                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`        | A standard turn.                                                                                                                                  |
| `backchannel`    | A short acknowledgement produced while the user held the floor.                                                                                   |
| `presence_check` | A prompt produced after extended silence.                                                                                                         |
| `filler`         | A line covering a wait, either on a function call or on an [`InjectAgentMessage`](/docs/voice-agent-inject-agent-message) sent with `is_dynamic`. |

Only [Think Live](/docs/voice-agent-think-live) produces the values other than `default`. While it is off, every message is reported as `default`, so a client that ignores the field behaves exactly as it did before the field existed.

Backchannels, presence checks, and filler are conversational scaffolding rather than substance. Most clients render them differently from a `default` turn, or suppress them entirely, to keep transcripts and UI readable.

## Multilingual Fields (Flux Multilingual)

When the `listen.provider.model` is set to `flux-general-multi`, user-role `ConversationText` messages include two additional fields surfaced from the STT [TurnInfo](/docs/flux/language-prompting#language-detection-in-turninfo-events) response:

| Field              | Type                  | Description                                                                 |
| ------------------ | --------------------- | --------------------------------------------------------------------------- |
| `languages_hinted` | string array (BCP-47) | The language hints that were active at the time of the turn.                |
| `languages`        | string array (BCP-47) | Languages detected in the user's speech, sorted by word count (descending). |

### Example

```json
{
  "type": "ConversationText",
  "role": "user",
  "content": "Hello, how are you amigo?",
  "languages_hinted": [
    "en",
    "es",
    "de"
  ],
  "languages": [
    "en",
    "es"
  ]
}
```

These fields allow your client to adapt downstream behavior — for example, selecting the correct TTS voice or LLM prompt language based on what the user actually spoke. For full details on language hints and detection, see [Flux Multilingual & Language Prompting](/docs/flux/language-prompting).