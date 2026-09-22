import { useEffect, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { chessConvai } from './convaiManager';
import Tooltip from './Tooltip';
import { playUiSound, unlockUiAudio } from './uiSounds';

type Props = {
  className?: string;
  showTooltip?: boolean;
  /** Portrait overlay uses absolute corner positioning; toolbar buttons stay in-flow. */
  overlay?: boolean;
};

/**
 * Microphone toggle, styled after the Convai dashboard's call bar: a round
 * icon button that lights up in the app's gold while live and sits muted-red
 * when off, with a soft pulse ring so "you are live" is unmistakable.
 *
 * A slash makes the default/off state unambiguous; enabling the microphone
 * removes the slash while retaining the existing live colour and pulse.
 */
export default function MicButton({ className, showTooltip = true }: Props) {
  const [micOn, setMicOn] = useState(false);

  useEffect(() => chessConvai.onStatus((s) => setMicOn(s.micEnabled)), []);

  function toggleMic() {
    unlockUiAudio();
    playUiSound('toggle');
    void chessConvai.setMicEnabled(!micOn);
  }

  const button = (
    <button
      type="button"
      className={`audio-btn mic-btn${micOn ? ' is-live' : ' is-off'}`}
      onClick={toggleMic}
      aria-label={micOn ? 'Mute microphone' : 'Enable microphone'}
      aria-pressed={micOn}
    >
      {micOn
        ? <Mic size={17} strokeWidth={2.2} />
        : <MicOff size={17} strokeWidth={2.2} />}
      {micOn && <span className="audio-btn-pulse" aria-hidden="true" />}
    </button>
  );

  return (
    <div className={`audio-controls ${className ?? ''}`.trim()}>
      {showTooltip ? (
        <Tooltip text={micOn ? 'Mute microphone' : 'Talk to your coach'} placement="top">
          {button}
        </Tooltip>
      ) : button}
    </div>
  );
}

/**
 * Coach-voice mute, overlaid on the top-right corner of the character window
 * (the dashboard puts speaker control on the video tile itself). Muting keeps
 * the audio stream advancing — lipsync and turn pacing are unaffected, you
 * just stop hearing her.
 */
export function VoiceMuteButton({ className, showTooltip = true, overlay = true }: Props) {
  const [voiceMuted, setVoiceMuted] = useState(() => chessConvai.getVoiceMuted());

  useEffect(() => chessConvai.onStatus((s) => setVoiceMuted(s.voiceMuted)), []);

  function toggleVoice() {
    unlockUiAudio();
    playUiSound('toggle');
    // Read the manager at click time: two quick presses can land before React
    // commits the status update, and a captured stale value would repeat Mute.
    chessConvai.setVoiceMuted(!chessConvai.getVoiceMuted());
  }

  const button = (
    <button
      type="button"
      className={`audio-btn speaker-btn${overlay ? ' character-mute-btn' : ' coach-speaker-btn'}${voiceMuted ? ' is-off' : ' is-live'} ${className ?? ''}`.trim()}
      onClick={toggleVoice}
      aria-label={voiceMuted ? 'Unmute coach voice' : 'Mute coach voice'}
      aria-pressed={voiceMuted}
    >
      {voiceMuted ? <VolumeX size={17} strokeWidth={2.2} /> : <Volume2 size={17} strokeWidth={2.2} />}
    </button>
  );

  return showTooltip ? (
    <Tooltip text={voiceMuted ? 'Unmute coach voice' : 'Mute coach voice'} placement="left">
      {button}
    </Tooltip>
  ) : button;
}
