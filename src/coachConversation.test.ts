import { describe, expect, it } from 'vitest';
import { mergeConversationMessage, type CoachConversationMessage } from './coachConversation';

function merger() {
  let id = 0;
  return (
    current: readonly CoachConversationMessage[],
    role: CoachConversationMessage['role'],
    text: string,
    responseId?: string,
  ) => mergeConversationMessage(current, role, text, () => ++id, responseId);
}

describe('coach conversation stream merging', () => {
  it('updates a cumulative partial and final response in one coach bubble', () => {
    const merge = merger();
    let messages = merge([], 'user', 'What should I calculate first?');
    messages = merge(messages, 'coach', 'Begin with forcing', 'convai-message-1');
    const partialId = messages[1].id;
    messages = merge(
      messages,
      'coach',
      'Begin with forcing moves and compare the candidate lines.',
      'convai-message-1',
    );

    expect(messages).toEqual([
      { id: 1, role: 'user', text: 'What should I calculate first?' },
      {
        id: partialId,
        role: 'coach',
        text: 'Begin with forcing moves and compare the candidate lines.',
        responseId: 'convai-message-1',
      },
    ]);
  });

  it('uses the latest content for a repeated SDK message id', () => {
    const merge = merger();
    const complete = merge([], 'coach', 'Choose a forcing move first.', 'reply-1');

    expect(merge(complete, 'coach', 'Choose a forcing move first.', 'reply-1')).toBe(complete);
    expect(merge(complete, 'coach', 'Choose a forcing', 'reply-1')).toEqual([
      { id: 1, role: 'coach', text: 'Choose a forcing', responseId: 'reply-1' },
    ]);
  });

  it('keeps a later distinct coach response as a separate message', () => {
    const merge = merger();
    let messages = merge([], 'coach', 'Your move is sound.');
    messages = merge(messages, 'user', 'What should I calculate next?');
    messages = merge(messages, 'coach', 'Start with checks, captures, and threats.');

    expect(messages).toHaveLength(3);
    expect(messages.map(({ role }) => role)).toEqual(['coach', 'user', 'coach']);
  });

  it('keeps identical wording from different Convai response ids as separate turns', () => {
    const merge = merger();
    let messages = merge([], 'coach', 'Look for checks first.', 'reply-1');
    messages = merge(messages, 'coach', 'Look for checks first.', 'reply-2');

    expect(messages).toHaveLength(2);
    expect(messages.map(({ responseId }) => responseId)).toEqual(['reply-1', 'reply-2']);
  });

  it('retains the 60-message cap while replacing the current streamed reply', () => {
    const merge = merger();
    let messages: CoachConversationMessage[] = [];
    for (let index = 0; index < 59; index += 1) {
      messages = merge(messages, 'user', `Message ${index}`);
    }
    messages = merge(messages, 'coach', 'Calculating', 'reply-final');
    const stableId = messages.at(-1)?.id;
    messages = merge(messages, 'coach', 'Calculating the forcing line.', 'reply-final');

    expect(messages).toHaveLength(60);
    expect(messages.at(-1)).toEqual({
      id: stableId,
      role: 'coach',
      text: 'Calculating the forcing line.',
      responseId: 'reply-final',
    });
  });
});
