import { describe, expect, it } from 'vitest';
import { applyVoiceMuteToElement } from './voiceMutePolicy';

describe('coach voice mute policy', () => {
  it('sets both live and default mute state and can restore them', () => {
    const audio = { muted: false, defaultMuted: false };
    applyVoiceMuteToElement(audio, true);
    expect(audio).toEqual({ muted: true, defaultMuted: true });

    applyVoiceMuteToElement(audio, false);
    expect(audio).toEqual({ muted: false, defaultMuted: false });
  });
});
