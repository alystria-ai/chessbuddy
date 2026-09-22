import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getGoogleClientId, signInWithGoogleCredential, type AuthUser } from './auth';
import {
  isConvaiAuthOffered,
  markConvaiAuthPending,
  signInWithConvaiRedirect,
} from './convaiAuth';
import {
  initializeGoogleSignIn,
  loadGoogleScript,
  renderGoogleSignInButton,
} from './googleSignIn';
import { playUiSound, unlockUiAudio } from './uiSounds';
import { useThemeCopy } from './themeCopy';

const CONVAI_LOGO_URL = `${import.meta.env.BASE_URL}convai-logo-mark.png`;

type Phase = 'chooser' | 'signing-in' | 'success' | 'error';

type Props = {
  open: boolean;
  onClose: () => void;
  onUserChange: (user: AuthUser) => void;
  startInSuccess?: AuthUser | null;
  startInError?: string | null;
};

const SUCCESS_CLOSE_MS = 1800;

export default function AuthSignInModal({ open, onClose, onUserChange, startInSuccess = null, startInError = null }: Props) {
  const themeCopy = useThemeCopy();
  const googleClientId = getGoogleClientId();
  const convaiOffered = isConvaiAuthOffered();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleRenderedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('chooser');
  const [status, setStatus] = useState('');
  const [successUser, setSuccessUser] = useState<AuthUser | null>(null);
  const [googleReady, setGoogleReady] = useState(false);

  const resetModal = useCallback(() => {
    setPhase('chooser');
    setStatus('');
    setSuccessUser(null);
    setGoogleReady(false);
    googleRenderedRef.current = false;
    if (googleButtonRef.current) googleButtonRef.current.innerHTML = '';
  }, []);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    unlockUiAudio();
    playUiSound('back');
    resetModal();
    onClose();
  }, [onClose, resetModal]);

  const finishSuccess = useCallback((user: AuthUser) => {
    setSuccessUser(user);
    setPhase('success');
    onUserChange(user);
    unlockUiAudio();
    playUiSound('confirm');
    closeTimerRef.current = window.setTimeout(() => {
      handleClose();
    }, SUCCESS_CLOSE_MS);
  }, [handleClose, onUserChange]);

  useEffect(() => {
    if (!open) return;
    if (startInSuccess) {
      setSuccessUser(startInSuccess);
      setPhase('success');
      unlockUiAudio();
      playUiSound('confirm');
      closeTimerRef.current = window.setTimeout(() => {
        handleClose();
      }, SUCCESS_CLOSE_MS);
      return;
    }
    if (startInError) {
      setPhase('error');
      setStatus(startInError);
      return;
    }
    resetModal();
  }, [open, startInSuccess, startInError, resetModal, handleClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || phase !== 'chooser' || !googleClientId || googleRenderedRef.current) return;
    let cancelled = false;
    void loadGoogleScript()
      .then(() => {
        if (cancelled || !googleButtonRef.current) return;
        initializeGoogleSignIn(googleClientId, (credential) => {
          setPhase('signing-in');
          setStatus('Signing in with Google...');
          void signInWithGoogleCredential(credential)
            .then((user) => finishSuccess(user))
            .catch((err) => {
              setPhase('error');
              setStatus(err instanceof Error ? err.message : 'Google sign-in failed.');
            });
        });
        renderGoogleSignInButton(googleButtonRef.current, { type: 'standard', size: 'large', width: 400 });
        googleRenderedRef.current = true;
        setGoogleReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setPhase('error');
          setStatus(err instanceof Error ? err.message : 'Google sign-in failed to load.');
        }
      });
    return () => { cancelled = true; };
  }, [open, phase, googleClientId, finishSuccess]);

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && phase !== 'signing-in') handleClose();
  }

  function handleConvaiSignIn() {
    unlockUiAudio();
    playUiSound('nav');
    setPhase('signing-in');
    setStatus('Redirecting to Convai...');
    markConvaiAuthPending();
    signInWithConvaiRedirect();
  }

  function handleTryAgain() {
    resetModal();
  }

  if (!open) return null;

  const providerLabel = successUser?.provider === 'convai' ? 'Convai' : 'Google';

  return createPortal(
    <div
      className="modal-backdrop auth-signin-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-signin-title"
      onClick={handleBackdropClick}
    >
      <div className="gameover-modal auth-signin-modal">
        <button
          type="button"
          className="auth-signin-close"
          onClick={handleClose}
          aria-label="Close sign in"
          disabled={phase === 'signing-in'}
        >
          <X size={18} aria-hidden="true" />
        </button>

        {phase === 'success' && successUser ? (
          <div className="auth-signin-success">
            <div className="auth-signin-success-mark" aria-hidden="true">✓</div>
            <h2 id="auth-signin-title">Welcome back</h2>
            <p className="auth-signin-success-name">{successUser.name || successUser.email}</p>
            <span className="auth-provider-tag">{providerLabel}</span>
            <p className="gameover-status">You&apos;re signed in and ready to play.</p>
          </div>
        ) : phase === 'signing-in' ? (
          <div className="auth-signin-pending">
            <div className="auth-signin-spinner" aria-hidden="true" />
            <h2 id="auth-signin-title">Signing in</h2>
            <p className="gameover-status">{status || 'Please wait...'}</p>
          </div>
        ) : phase === 'error' ? (
          <div className="auth-signin-error">
            <h2 id="auth-signin-title">Sign in failed</h2>
            <p className="warning-text">{status || 'Something went wrong.'}</p>
            <div className="gameover-actions">
              <button type="button" className="primary-action" onClick={handleTryAgain}>Try again</button>
              <button type="button" className="ghost-action" onClick={handleClose}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div className="auth-signin-header">
              <h2 className="gameover-result" id="auth-signin-title" aria-label="Sign in to Chessbuddy">
                Sign in to {themeCopy.productTitle}
              </h2>
              <p className="gameover-status auth-signin-subtitle">
                Choose how you want to sign in. Your progress and coaching memory sync to your account.
              </p>
            </div>

            <div className="auth-provider-list">
              <div
                className={`auth-provider-button auth-provider-button-google${googleClientId ? (googleReady ? '' : ' is-loading') : ' is-unavailable'}`}
                aria-busy={Boolean(googleClientId && !googleReady)}
                aria-disabled={!googleClientId}
              >
                <span className="auth-provider-icon auth-provider-icon-google" aria-hidden="true">G</span>
                <span className="auth-provider-label" aria-hidden="true">
                  <strong>Sign in with Google</strong>
                  <small>{googleClientId ? 'Sync coaching memory with your Google account' : 'Available on the production site'}</small>
                </span>
                {googleClientId && (
                  <div
                    className="auth-provider-google-overlay"
                    ref={googleButtonRef}
                    aria-label="Sign in with Google"
                  />
                )}
              </div>
              {convaiOffered && (
                <button type="button" className="auth-provider-button auth-provider-button-convai" onClick={handleConvaiSignIn}>
                  <span className="auth-provider-icon auth-provider-icon-convai" aria-hidden="true">
                    <img src={CONVAI_LOGO_URL} alt="" />
                  </span>
                  <span className="auth-provider-label">
                    <strong>Sign in with Convai</strong>
                    <small>Connects your Convai account for voice coaching</small>
                  </span>
                </button>
              )}
            </div>

            {!googleClientId && !convaiOffered && (
              <p className="warning-text">No sign-in providers are configured for this deployment.</p>
            )}

            {convaiOffered && (
              <div className="auth-signin-help">
                <p>
                  New to Convai?{' '}
                  <a href="https://convai.com" target="_blank" rel="noreferrer">Create a free account at convai.com</a>
                </p>
              </div>
            )}

          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
