/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVAI_LOGIN_URL?: string;
  readonly VITE_CONVAI_DECRYPT_URL?: string;
  readonly VITE_CONVAI_AUTH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __DATASET_TOOLS_ENABLED__: boolean;
