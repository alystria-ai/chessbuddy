export type CoachConversationMessage = {
  id: number;
  role: 'user' | 'coach';
  text: string;
  /** Stable Convai ChatMessage id while one streamed coach reply grows. */
  responseId?: string;
};

const MAX_CONVERSATION_MESSAGES = 60;

/**
 * Merge one cumulative Convai transcript update into the visible conversation.
 *
 * Convai emits the whole answer-so-far for every stream chunk. A later chunk
 * therefore extends (or occasionally repeats) the previous coach text; it is
 * not a second message. User messages and genuinely distinct coach messages
 * still append normally.
 */
export function mergeConversationMessage(
  current: readonly CoachConversationMessage[],
  role: CoachConversationMessage['role'],
  rawText: string,
  nextId: () => number,
  responseId?: string,
): CoachConversationMessage[] {
  const text = rawText.trim();
  if (!text) return current as CoachConversationMessage[];

  const previous = current[current.length - 1];
  if (previous?.role === role) {
    if (role === 'coach' && responseId && previous.responseId === responseId) {
      if (previous.text === text) return current as CoachConversationMessage[];
      return [
        ...current.slice(0, -1),
        { ...previous, text },
      ];
    }

    // Distinct source ids are distinct turns, even when Convai happens to use
    // identical wording. An uncorrelated local final may still repeat the SDK
    // final exactly, in which case it is presentation state rather than a new
    // transcript event.
    if (previous.text === text && !(responseId && previous.responseId)) {
      return current as CoachConversationMessage[];
    }
  }

  return [
    ...current,
    { id: nextId(), role, text, ...(responseId ? { responseId } : {}) },
  ].slice(-MAX_CONVERSATION_MESSAGES);
}
