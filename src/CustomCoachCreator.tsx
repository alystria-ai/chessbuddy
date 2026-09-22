import { useEffect, useMemo, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { AuthUser } from './auth';
import { COACHES, getCoachPortraitThumbUrl, type BuiltinCoachId, type CoachId } from './coachConfig';
import {
  createConvaiCharacter,
  DEFAULT_MODEL,
  fetchCreatorOptions,
  filterVoicesForLanguage,
  MODEL_OPTIONS,
  pickDefaultVoice,
  type LanguageOption,
  type VoiceOption,
} from './convaiCreatorApi';
import { saveCustomCoach } from './customCoaches';
import { clickBack, playUiSound, unlockUiAudio } from './uiSounds';

const DEFAULT_BACKSTORY = 'A patient chess coach who adapts to my level, explains ideas clearly, and gives progressive hints before revealing answers.';
const DEFAULT_STYLE = 'Clear, concise, encouraging, and specific about the current position.';

type Props = { user: AuthUser | null; onBack: () => void };

export default function CustomCoachCreator({ user, onBack }: Props) {
  const allowed = user?.provider === 'convai';
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [name, setName] = useState('My Chess Coach');
  const [backstory, setBackstory] = useState(DEFAULT_BACKSTORY);
  const [speakingStyle, setSpeakingStyle] = useState(DEFAULT_STYLE);
  const [sampleDialogue, setSampleDialogue] = useState('Look for forcing moves first: checks, captures, and threats.');
  const [baseCoachId, setBaseCoachId] = useState<BuiltinCoachId>('sofia');
  const [voice, setVoice] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(0.45);
  const [status, setStatus] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState('');
  const compatibleVoices = useMemo(() => filterVoicesForLanguage(voices, language), [voices, language]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoadingOptions(true);
    setStatus('Loading voices from your Convai account…');
    void fetchCreatorOptions()
      .then((options) => {
        if (cancelled) return;
        setVoices(options.voices);
        setLanguages(options.languages);
        const nextLanguage = options.languages.find((entry) => entry.code === 'en-US')?.code
          ?? options.languages[0]?.code
          ?? 'en-US';
        setLanguage(nextLanguage);
        setVoice(pickDefaultVoice(options.voices, nextLanguage));
        setStatus(options.voices.length ? '' : 'No compatible voices were returned by your Convai account.');
      })
      .catch((error) => { if (!cancelled) setStatus(error instanceof Error ? error.message : 'Could not load Convai creator options.'); })
      .finally(() => { if (!cancelled) setLoadingOptions(false); });
    return () => { cancelled = true; };
  }, [allowed]);

  useEffect(() => {
    if (!compatibleVoices.some((entry) => entry.value === voice)) setVoice(pickDefaultVoice(voices, language));
  }, [compatibleVoices, language, voice, voices]);

  async function createCoach() {
    if (!allowed) { setStatus('Sign in with Convai before creating a coach.'); return; }
    const trimmedName = name.trim();
    if (!trimmedName || !backstory.trim()) { setStatus('Add a coach name and coaching background first.'); return; }
    if (!voice) { setStatus('Choose a voice before creating the coach.'); return; }
    setCreating(true);
    setStatus('Creating this character in your Convai account…');
    try {
      const result = await createConvaiCharacter({
        charName: trimmedName,
        voiceType: voice,
        backstory: backstory.trim(),
        languageCodes: [language],
        model,
        temperature,
        speakingStyleDescription: speakingStyle.trim() || undefined,
        sampleDialogue: sampleDialogue.trim() || undefined,
      });
      const customId = `custom-${result.charID.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}` as CoachId;
      saveCustomCoach({
        source: 'convai-character',
        id: customId,
        name: trimmedName,
        characterId: result.charID,
        backstory: backstory.trim(),
        createdAt: new Date().toISOString(),
        speakingStyleDescription: speakingStyle.trim() || undefined,
        sampleDialogue: sampleDialogue.trim() || undefined,
        baseCoachId,
      });
      unlockUiAudio();
      playUiSound('confirm');
      setCreatedId(result.charID);
      setStatus(`${trimmedName} was created in your Convai account. Open Game settings to select the coach.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Convai could not create the character.');
    } finally {
      setCreating(false);
    }
  }

  const disabled = !allowed || creating;
  return (
    <main className="game-screen" data-screen="creator" data-screen-state={allowed ? (createdId ? 'created' : 'editing') : 'locked'}>
      <header className="topbar"><button onClick={() => clickBack(onBack)}>Menu</button><h1>Create a Coach</h1><div className="topbar-actions" /></header>
      <section className="creator-layout">
        <div className="panel-card creator-form">
          <h2>Create your coach</h2>
          {!allowed && (
            <div className="creator-disabled-notice" role="status">
              <LockKeyhole size={20} aria-hidden="true" />
              <div><strong>Convai sign-in required</strong><p>Return to the game screen and sign in with Convai. Character creation also requires a Convai Professional plan or higher.</p></div>
            </div>
          )}
          <label className="creator-field creator-field--name">Name<input value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
          <div className="creator-model-field creator-section creator-section--appearance">
            <p className="creator-model-title">Chessbuddy appearance</p>
            <span className="field-hint">Choose which Chessbuddy 3D model represents your new Convai character.</span>
            <div className="coach-picker creator-model-picker">
              {COACHES.map((coach) => (
                <button key={coach.id} type="button" disabled={disabled} className={coach.id === baseCoachId ? 'selected-option' : ''} onClick={() => setBaseCoachId(coach.id as BuiltinCoachId)} style={{ borderColor: coach.id === baseCoachId ? coach.accent : undefined }}>
                  <span className="coach-picker-avatar-wrap" aria-hidden="true"><img className="coach-picker-avatar coach-picker-avatar--baked" src={getCoachPortraitThumbUrl(coach)} alt="" width={384} height={384} decoding="async" draggable={false} /></span>
                  <span className="coach-picker-label"><span>{coach.name}</span><small>{coach.title}</small></span>
                </button>
              ))}
            </div>
          </div>
          <label className="creator-field creator-field--backstory">Backstory<textarea value={backstory} disabled={disabled} onChange={(event) => setBackstory(event.target.value)} /></label>
          <label className="creator-field creator-field--speaking-style">Speaking style<textarea className="creator-tall-field" value={speakingStyle} disabled={disabled} onChange={(event) => setSpeakingStyle(event.target.value)} /></label>
          <label className="creator-field creator-field--sample-dialogue">Example dialogue<textarea className="creator-tall-field" value={sampleDialogue} disabled={disabled} onChange={(event) => setSampleDialogue(event.target.value)} /></label>
          <div className="form-row creator-row creator-row--voice">
            <label>Voice<select value={voice} disabled={disabled || loadingOptions} onChange={(event) => setVoice(event.target.value)}><option value="">{loadingOptions ? 'Loading voices…' : 'Choose a voice'}</option>{compatibleVoices.map((entry) => <option key={entry.value} value={entry.value}>{entry.name} ({entry.gender})</option>)}</select></label>
            <label>Language<select value={language} disabled={disabled || loadingOptions} onChange={(event) => setLanguage(event.target.value)}>{languages.length === 0 && <option value="en-US">English</option>}{languages.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
          </div>
          <div className="form-row creator-row creator-row--model">
            <label>LLM model<select value={model} disabled={disabled} onChange={(event) => setModel(event.target.value)}>{MODEL_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
            <label>Temperature<input type="number" min="0" max="1" step="0.05" value={temperature} disabled={disabled} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
          </div>
          <div className="creator-actions"><button className="primary-action" type="button" disabled={disabled || loadingOptions || !voice} onClick={() => void createCoach()}>{creating ? 'Creating in Convai…' : 'Create coach'}</button></div>
          {status && <p className="hint-text" role="status">{status}</p>}
          {createdId && <code className="created-id">{createdId}</code>}
        </div>
      </section>
    </main>
  );
}
