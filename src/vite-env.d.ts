/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WEBRTC_CONFIG?: string;
  readonly VITE_MEDIAMTX_WEBRTC_BASE_URL?: string;
  readonly VITE_MEDIAMTX_STREAM_PATH?: string;
  readonly VITE_MEDIAMTX_PUBLISHER_USER?: string;
  readonly VITE_MEDIAMTX_PUBLISHER_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
