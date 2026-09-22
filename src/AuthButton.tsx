import { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import {
  fetchAuthUser,
  getCachedAuthUser,
  persistAuthUser,
  signOutAuth,
  type AuthUser,
} from './auth';
import AuthSignInModal from './AuthSignInModal';
import {
  clearConvaiAuthPending,
  convaiSessionToAuthUser,
  fetchConvaiAuthSessionResult,
  isConvaiAuthConfigured,
  isConvaiAuthPending,
} from './convaiAuth';
import { disableGoogleAutoSelect } from './googleSignIn';
import { playUiSound, unlockUiAudio } from './uiSounds';

type Props = {
  user: AuthUser | null;
  /**
   * `justSignedIn` marks a real sign-in the user just performed, as opposed to
   * a silent session restore on load — only the former should be announced.
   */
  onUserChange: (user: AuthUser | null, meta?: { justSignedIn?: boolean }) => void;
};

const CONVAI_SESSION_ERROR = 'Could not read your Convai session. Try signing in again.';

let authBootstrapDone = false;

export function isAuthOffered(): boolean {
  // Keep account discovery stable even if deployment configuration is briefly
  // unavailable; the modal owns provider-specific availability and messaging.
  return true;
}

function applyConvaiSession(
  session: NonNullable<Awaited<ReturnType<typeof fetchConvaiAuthSessionResult>>['session']>,
  onUserChange: Props['onUserChange'],
): AuthUser {
  const nextUser = convaiSessionToAuthUser(session);
  persistAuthUser(nextUser);
  // Returning from the Convai redirect IS the completion of a sign-in.
  onUserChange(nextUser, { justSignedIn: true });
  return nextUser;
}

export default function AuthButton({ user, onUserChange }: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [signInModalOpen, setSignInModalOpen] = useState(false);
  const [convaiSuccessUser, setConvaiSuccessUser] = useState<AuthUser | null>(null);
  const [convaiRestoreError, setConvaiRestoreError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const onUserChangeRef = useRef(onUserChange);

  useEffect(() => {
    onUserChangeRef.current = onUserChange;
  }, [onUserChange]);

  useEffect(() => {
    if (authBootstrapDone) return;
    authBootstrapDone = true;

    let cancelled = false;
    void (async () => {
      const returningFromConvai = isConvaiAuthPending();

      if (returningFromConvai && isConvaiAuthConfigured()) {
        const { session, reason } = await fetchConvaiAuthSessionResult();
        if (cancelled) return;
        if (session) {
          const nextUser = applyConvaiSession(session, onUserChangeRef.current);
          clearConvaiAuthPending();
          setConvaiSuccessUser(nextUser);
          setSignInModalOpen(true);
          return;
        }
        clearConvaiAuthPending();
        setConvaiRestoreError(reason ?? CONVAI_SESSION_ERROR);
        setSignInModalOpen(true);
        return;
      }

      const cachedUser = getCachedAuthUser() ?? await fetchAuthUser();
      if (cancelled) return;
      if (cachedUser) {
        onUserChangeRef.current(cachedUser);
        return;
      }

      if (!cancelled) onUserChangeRef.current(null);
    })().catch(() => {
      if (!cancelled) onUserChangeRef.current(null);
    });

    return () => { cancelled = true; };
  }, []);

  async function handleSignOut() {
    unlockUiAudio();
    playUiSound('tap');
    setStatus('Signing out...');
    try {
      await signOutAuth(user);
      disableGoogleAutoSelect();
      onUserChange(null);
      setPopoverOpen(false);
      setStatus('');
    } catch {
      setStatus('Could not sign out.');
    }
  }

  function openSignInModal() {
    unlockUiAudio();
    playUiSound('tap');
    setConvaiSuccessUser(null);
    setConvaiRestoreError(null);
    setSignInModalOpen(true);
  }

  function closeSignInModal() {
    setSignInModalOpen(false);
    setConvaiSuccessUser(null);
    setConvaiRestoreError(null);
  }

  function handleSignedIn(nextUser: AuthUser) {
    persistAuthUser(nextUser);
    onUserChange(nextUser, { justSignedIn: true });
  }

  if (!isAuthOffered() && !user) return null;

  const providerLabel = user?.provider === 'convai' ? 'Convai voice coaching account' : 'Google account and Convai memory';

  return (
    <>
      <div className="auth-control">
        {user ? (
          <div className="auth-user-menu">
            <button
              type="button"
              className="auth-avatar-button"
              aria-label={`${user.name || user.email}, ${providerLabel}`}
              title={providerLabel}
              onClick={() => {
                unlockUiAudio();
                playUiSound('tap');
                setPopoverOpen((value) => !value);
              }}
            >
              {user.picture ? <img src={user.picture} alt="" /> : <UserRound size={17} aria-hidden="true" />}
              <span>{user.name || user.email}</span>
            </button>
            {popoverOpen && (
              <div className="auth-popover">
                <strong>{user.name || 'Signed in'}</strong>
                <span>{user.email}</span>
                {user.provider === 'convai' && <span className="auth-provider-tag">Convai</span>}
                <button type="button" onClick={() => void handleSignOut()}>
                  <LogOut size={15} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="auth-signin-trigger" onClick={openSignInModal}>
            Sign in
          </button>
        )}
        {status && <div className="auth-status">{status}</div>}
      </div>

      <AuthSignInModal
        open={signInModalOpen}
        onClose={closeSignInModal}
        onUserChange={handleSignedIn}
        startInSuccess={convaiSuccessUser}
        startInError={convaiRestoreError}
      />
    </>
  );
}
