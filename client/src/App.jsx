import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const ROOM = 'demo-room';
const WS_URL = 'ws://localhost:1234';

function App() {
  const textareaRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [peers, setPeers] = useState(1);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, ROOM, ydoc);
    const ytext = ydoc.getText('content');
    const textarea = textareaRef.current;

    provider.on('status', (event) => setStatus(event.status));
    provider.awareness.on('change', () => {
      setPeers(provider.awareness.getStates().size);
    });

    // Seed the textarea with whatever is already in the shared doc.
    textarea.value = ytext.toString();

    // NOTE: this is a deliberately naive binding — on every keystroke we
    // wipe and rewrite the whole Y.Text. It's enough to prove the sync path
    // works end to end, but it will fight cursor position with two people
    // typing at once. A real implementation should bind character-level
    // deltas instead (see y-textarea, or a ProseMirror/CodeMirror binding
    // for a richer editor). Upgrading this is a good "phase 2" milestone.
    const updateFromYjs = () => {
      if (textarea.value !== ytext.toString()) {
        textarea.value = ytext.toString();
      }
    };
    ytext.observe(updateFromYjs);

    const handleInput = () => {
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, textarea.value);
      });
    };
    textarea.addEventListener('input', handleInput);

    return () => {
      textarea.removeEventListener('input', handleInput);
      ytext.unobserve(updateFromYjs);
      provider.destroy();
      ydoc.destroy();
    };
  }, []);

  return (
    <div className="app">
      <h1>Collab editor</h1>
      <p>
        Room: <code>{ROOM}</code> · Status: <code>{status}</code> · Connected clients:{' '}
        <code>{peers}</code>
      </p>
      <textarea ref={textareaRef} rows={20} cols={80} />
      <p className="hint">
        Open this page in two browser tabs and type in both — edits should sync live.
      </p>
    </div>
  );
}

export default App;
