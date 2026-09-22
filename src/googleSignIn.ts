let googleScriptPromise: Promise<void> | null = null;
let googleIdentityInitialized = false;
let googleClientIdInUse = '';

export function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google sign-in.'));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

export function initializeGoogleSignIn(
  clientId: string,
  callback: (credential: string) => void,
): void {
  if (!window.google?.accounts?.id) return;
  if (!googleIdentityInitialized || googleClientIdInUse !== clientId) {
    window.google.accounts.id.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      auto_select: false,
      callback: (response) => {
        if (response.credential) callback(response.credential);
      },
    });
    googleIdentityInitialized = true;
    googleClientIdInUse = clientId;
  }
}

export function renderGoogleSignInButton(
  parent: HTMLElement,
  options?: {
    type?: 'standard' | 'icon';
    size?: 'small' | 'medium' | 'large';
    text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
    width?: number;
  },
): void {
  if (!window.google?.accounts?.id) return;
  parent.innerHTML = '';
  window.google.accounts.id.renderButton(parent, {
    type: options?.type ?? 'standard',
    theme: 'outline',
    size: options?.size ?? 'large',
    shape: 'rectangular',
    text: options?.text ?? 'signin_with',
    width: options?.width,
  });
}

export function clickGoogleSignInButton(parent: HTMLElement | null): boolean {
  if (!parent) return false;
  const target = parent.querySelector<HTMLElement>('[role="button"], iframe');
  if (!target) return false;
  if (target.tagName === 'IFRAME') {
    target.click();
    return true;
  }
  target.click();
  return true;
}

export function disableGoogleAutoSelect(): void {
  window.google?.accounts?.id?.disableAutoSelect();
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize(options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            ux_mode?: 'popup' | 'redirect';
            auto_select?: boolean;
          }): void;
          renderButton(
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'small' | 'medium' | 'large';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              width?: number;
            },
          ): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}
