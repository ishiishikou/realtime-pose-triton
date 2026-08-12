import { useState } from 'react';

import { MediaMtxVlmNarrationPanel } from './components/MediaMtxVlmNarrationPanel';
import { PoseWebRtcPanel } from './components/PoseWebRtcPanel';

type AppMode = 'pose' | 'narration';

const getInitialMode = (): AppMode => {
  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  return requestedMode === 'narration' ? 'narration' : 'pose';
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
    <main className="app-shell">
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
