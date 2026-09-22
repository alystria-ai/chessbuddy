import { describe, expect, it, vi } from 'vitest';
import { sequenceCoachMove } from './coachMoveSequence';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('sequenceCoachMove', () => {
  it.each(['coach-decides', 'game-decides'])('holds a speaking %s move until speech finishes', async () => {
    const speech = deferred<string>();
    const commit = vi.fn();
    const running = sequenceCoachMove({
      shouldSpeak: true,
      speak: () => speech.promise,
      isCurrent: () => true,
      commit,
    });

    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    speech.resolve('Your move.');
    await expect(running).resolves.toMatchObject({ committed: true, spoken: 'Your move.' });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('commits a deliberately silent turn immediately', async () => {
    const speak = vi.fn();
    const commit = vi.fn();
    await expect(sequenceCoachMove({
      shouldSpeak: false,
      speak,
      isCurrent: () => true,
      commit,
    })).resolves.toMatchObject({ committed: true });
    expect(speak).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('drops a pending move if its game sequence becomes stale during speech', async () => {
    const speech = deferred<string>();
    const commit = vi.fn();
    let current = true;
    const running = sequenceCoachMove({
      shouldSpeak: true,
      speak: () => speech.promise,
      isCurrent: () => current,
      commit,
    });
    current = false;
    speech.resolve('Too late.');
    await expect(running).resolves.toMatchObject({ committed: false });
    expect(commit).not.toHaveBeenCalled();
  });

  it('still commits and reports a failed speech turn', async () => {
    const commit = vi.fn();
    const onSpeechError = vi.fn();
    const error = new Error('audio failed');
    const result = await sequenceCoachMove({
      shouldSpeak: true,
      speak: () => Promise.reject(error),
      isCurrent: () => true,
      commit,
      onSpeechError,
    });
    expect(result).toMatchObject({ committed: true, speechError: error });
    expect(commit).toHaveBeenCalledOnce();
    expect(onSpeechError).toHaveBeenCalledWith(error);
  });

  it('still commits when speech diagnostics themselves throw', async () => {
    const commit = vi.fn();
    const result = await sequenceCoachMove({
      shouldSpeak: true,
      speak: () => Promise.reject(new Error('audio failed')),
      isCurrent: () => true,
      commit,
      onSpeechError: () => { throw new Error('logger failed'); },
    });
    expect(result.committed).toBe(true);
    expect(result.speechError).toBeInstanceOf(Error);
    expect(commit).toHaveBeenCalledOnce();
  });
});
