import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';

/**
 * A CodeMirror editor bound to a shared Y.Text.
 *
 * yCollab turns each keystroke into a precise insert/delete on the Y.Text
 * (instead of rewriting the whole document) and draws other users' cursors
 * and selections from the awareness state.
 */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeFor = (isDark) => (isDark ? oneDark : []);

export default function Editor({ ytext, awareness }) {
  const hostRef = useRef(null);

  useEffect(() => {
    // Undo only your own edits, not other people's.
    const undoManager = new Y.UndoManager(ytext);
    // Follow the system light/dark setting, including changes while open.
    const theme = new Compartment();
    const view = new EditorView({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        theme.of(themeFor(darkQuery.matches)),
        yCollab(ytext, awareness, { undoManager }),
      ],
      parent: hostRef.current,
    });
    view.focus();

    const onThemeChange = (e) => view.dispatch({ effects: theme.reconfigure(themeFor(e.matches)) });
    darkQuery.addEventListener('change', onThemeChange);

    return () => {
      darkQuery.removeEventListener('change', onThemeChange);
      view.destroy();
      undoManager.destroy();
    };
  }, [ytext, awareness]);

  return <div ref={hostRef} className="editor" />;
}
