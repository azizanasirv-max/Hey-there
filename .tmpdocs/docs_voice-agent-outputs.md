> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Outputs: Server Events

Server Events are messages sent from the Deepgram server to the client over the WebSocket connection during a voice agent interaction. These events provide real-time updates about the conversation's status, including user and agent actions, as well as any processing that's occurring.

## List of Server Events

* [`Welcome`](/docs/voice-agent-welcome-message): Confirms that the WebSocket has opened successfully.
* [`Settings Applied`](/docs/voice-agent-setting-applied-message): Confirms that the configuration settings have been applied.
* [`Conversation Text`](/docs/voice-agent-conversation-text): Provides the text of what was spoken by either the user or the agent.
* [`User Started Speaking`](/docs/voice-agent-user-started-speaking): Notifies that the user has begun speaking.
* [`Agent Thinking`](/docs/voice-agent-agent-thinking): Informs the client that the agent is processing information.
* [`Function Call Request`](/docs/voice-agent-function-call-request): Sent when the agent needs to make a function call.
* [`Function Call Response`](/docs/voice-agent-function-call-response): Sent to provide information about a function call.
* [`Function Call Cancelled`](/docs/voice-agent-function-call-cancelled): Sent when a function call the client already received is cancelled because the user started speaking again, either inside the speculative window or after the turn was confirmed.
* [`PromptUpdated` / `SpeakUpdated` / `ThinkUpdated`](/docs/voice-agent-acknowledgements): Server confirms that an `Update*` message has been applied.
* [`Agent Audio Done`](/docs/voice-agent-agent-audio-done): Indicates that the server has finished sending the final audio segment to the client.
* [`Error` / `Warning`](/docs/voice-agent-errors-warnings): Server reports a fatal error (`Error`) or non-fatal issue (`Warning`).
* [`Latency Report`](/docs/voice-agent-latency-report): Provides a detailed STT, LLM, and TTS latency breakdown for each turn.

Each of these events serves a specific purpose in managing the flow of the conversation and keeping the client informed about the state of the interaction. They allow for a dynamic and responsive experience when using Deepgram's Voice Agent API.