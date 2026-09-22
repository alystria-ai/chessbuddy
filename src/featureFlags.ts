/**
 * External Convai account linking is disabled until Convai provides a
 * supported callback for chessbuddy.live. Keep the dormant server work behind
 * one flag so sign-in, creator routes and stored custom characters cannot leak
 * into the UI independently.
 */
export const CONVAI_ACCOUNT_FEATURES_ENABLED = false;
