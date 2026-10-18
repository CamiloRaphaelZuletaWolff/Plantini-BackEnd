/**
 * Adapts the Interactions API streaming response into a plain stream of text
 * pieces. The controller writes these directly to the HTTP response, so it
 * stays decoupled from the SDK's event/step schema.
 *
 * The Interactions stream emits typed SSE events
 * (`interaction.created` → `step.start` → `step.delta`* → `step.stop` →
 * `interaction.completed`); only `step.delta` events whose delta is text carry
 * generated content. Empty/undefined text and non-text deltas (images, thoughts,
 * tool calls) are skipped.
 *
 * The parameter is typed structurally so the SDK's `Stream<InteractionSSEEvent>`
 * (whose event union exposes `event_type` and an optional text-bearing `delta`)
 * is assignable without importing the SDK's internal event types.
 */
export async function* streamInteractionText(
  stream: AsyncIterable<{
    event_type?: string;
    delta?: { type?: string; text?: string };
  }>,
): AsyncGenerator<string> {
  for await (const event of stream) {
    if (
      event.event_type === 'step.delta' &&
      event.delta?.type === 'text' &&
      typeof event.delta.text === 'string' &&
      event.delta.text.length > 0
    ) {
      yield event.delta.text;
    }
  }
}
