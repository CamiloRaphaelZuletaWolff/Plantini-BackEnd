/**
 * Local types and mappers for the Gemini Interactions API.
 *
 * `StoredMessage` is OUR persisted chat-message shape, intentionally decoupled
 * from any `@google/genai` type so the `chat_histories.messages` JSONB column
 * stays stable across SDK upgrades. It mirrors the legacy `{ role, parts }`
 * format the table already holds, so migrating to the Interactions API needs
 * no data migration and the `GET /chat-history` response contract is unchanged.
 *
 * The `InputTurn` / `InputContentPart` shapes are structurally assignable to
 * the SDK's `InteractionsInput` (`Turn[]` / `Content[]` members), so we build
 * the request `input` ourselves and replay history as turns — keeping Supabase
 * as the single source of truth instead of server-side `previous_interaction_id`.
 */

/** Persisted chat-message shape (matches the JSONB already in `chat_histories`). */
export interface StoredMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/** A single content block inside an Interactions API input turn. */
export type InputContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; uri?: string; data?: string; mime_type?: string }
  | { type: 'document'; uri?: string; data?: string; mime_type?: string };

/**
 * A conversation step for the Interactions API `input`. The steps-based API
 * (SDK >= 2.x) requires the `step_list` shape (`{ type, content }`) — a
 * `turn_list` (`{ role, content }`) is rejected at runtime with
 * "use step_list input format instead of turn_list". A user message is a
 * `user_input` step; a prior model reply is a `model_output` step. Structurally
 * assignable to the SDK's `Step` (`Array<Step>`) member of `InteractionsInput`.
 */
export type InputStep =
  | { type: 'user_input'; content: InputContentPart[] }
  | { type: 'model_output'; content: InputContentPart[] };

/** Minimal shape of a file returned by `ai.files.upload`. */
export interface UploadedFileRef {
  uri?: string;
  mimeType?: string;
}

/** Joins a stored message's parts into a single text string. */
export const messageToText = (message: StoredMessage): string =>
  message.parts.map((part) => part.text).join('');

/** Maps an uploaded file to an Interactions API content part (image vs document). */
export const uploadedFileToContentPart = (
  file: UploadedFileRef,
): InputContentPart => {
  const mimeType = file.mimeType ?? '';
  if (mimeType.startsWith('image/')) {
    return { type: 'image', uri: file.uri, mime_type: mimeType };
  }
  return { type: 'document', uri: file.uri, mime_type: mimeType };
};

/**
 * Builds the full Interactions `input` from prior history plus the new user
 * turn (text + any uploaded files). Prior turns are replayed verbatim so the
 * model has the full conversation context on every (stateless) request.
 */
export const buildConversationInput = (
  history: StoredMessage[],
  prompt: string,
  files: UploadedFileRef[] = [],
): InputStep[] => {
  const priorSteps: InputStep[] = history.map((message) =>
    message.role === 'user'
      ? {
          type: 'user_input',
          content: [{ type: 'text', text: messageToText(message) }],
        }
      : {
          type: 'model_output',
          content: [{ type: 'text', text: messageToText(message) }],
        },
  );

  const currentStep: InputStep = {
    type: 'user_input',
    content: [
      { type: 'text', text: prompt },
      ...files.map(uploadedFileToContentPart),
    ],
  };

  return [...priorSteps, currentStep];
};
