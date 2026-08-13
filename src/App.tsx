import { useState } from 'react';

import { MediaMtxVlmNarrationPanel } from './components/MediaMtxVlmNarrationPanel';
import { PoseWebRtcPanel } from './components/PoseWebRtcPanel';

type AppMode = 'pose' | 'narration';
type PerfBootstrapWindow = Window & { __perfResults?: unknown[] };

const getInitialMode = (): AppMode => {
  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  if (requestedMode === 'narration') {
    return 'narration';
  }
  if (Array.isArray((window as PerfBootstrapWindow).__perfResults)) {
    return 'narration';
  }
  return 'pose';
};

const App = () => {
  const [mode, setMode] = useState<AppMode>(getInitialMode);

  const selectMode = (nextMode: AppMode) => {
    setMode(nextMode);
    const url = new URL(window.location.href);
    if (nextMode === 'narration') {
      url.searchParams.set('mode', 'narration');
    } else {
      url.searchParams.delete('mode');
    }
    window.history.replaceState({}, '', url);
  };

  return (
    <main className={`app-shell app-shell-${mode}`}>
      <nav className="app-mode-switch" aria-label="demo mode">
        <button className={mode === 'pose' ? 'source-mode-button active' : 'source-mode-button'} type="button" onClick={() => selectMode('pose')}>
          RTMPose
        </button>
        <button className={mode === 'narration' ? 'source-mode-button active' : 'source-mode-button'} type="button" onClick={() => selectMode('narration')}>
          VLMナレーション
        </button>
      </nav>
      {mode === 'pose' ? <PoseWebRtcPanel /> : <MediaMtxVlmNarrationPanel />}
    </main>
  );
};

export default App;
