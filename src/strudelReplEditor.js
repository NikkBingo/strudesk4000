/**
 * Strudel REPL Editor - CodeMirror integration for Strudel patterns
 * Provides syntax highlighting, autocomplete, and Strudel REPL features
 */

import { EditorView, lineNumbers, keymap, Decoration } from '@codemirror/view';
import { EditorState, EditorSelection, StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, foldKeymap, bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';

// Store editor instances by textarea ID
const editorInstances = new Map();

const setHighlightsEffect = StateEffect.define();

const highlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    if (tr.docChanged) {
      value = value.map(tr.changes);
    }
    for (const effect of tr.effects) {
      if (effect.is(setHighlightsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});

const highlightDecoration = Decoration.mark({ class: 'cm-master-highlight' });

/**
 * Create a Strudel REPL editor from a textarea element
 * @param {HTMLTextAreaElement} textarea - The textarea element to replace
 * @param {Object} options - Configuration options
 * @returns {EditorView} - The CodeMirror editor view
 */
export function createStrudelReplEditor(textarea, options = {}) {
  const {
    theme = 'light', // 'light' or 'dark'
    placeholder = '',
    lineNumbers: showLineNumbers = true,
    autofocus = false,
    onUpdate = null
  } = options;

  // Get initial value from textarea
  const initialValue = textarea.value || '';

  // Create extensions
  const extensions = [
    showLineNumbers ? lineNumbers() : [],
    history(),
    foldGutter(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap
    ]),
    javascript(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onUpdate) {
        const value = update.state.doc.toString();
        onUpdate(value);
      }
      // Sync to textarea
      if (update.docChanged) {
        const value = update.state.doc.toString();
        textarea.value = value;
        // Trigger input event so other code can listen to it
        const event = new Event('input', { bubbles: true });
        textarea.dispatchEvent(event);
      }
    }),
    EditorView.contentAttributes.of({ 'data-placeholder': placeholder }),
    // Base theme with essential styles for CodeMirror
    EditorView.baseTheme({
      '&.cm-editor': {
        outline: 'none',
        position: 'relative',
        boxSizing: 'border-box'
      },
      '.cm-scroller': {
        display: 'flex !important',
        alignItems: 'flex-start !important',
        fontFamily: 'monospace',
        lineHeight: '1.4',
        height: '100%',
        overflowX: 'auto',
        position: 'relative',
        zIndex: '0'
      },
      '.cm-content': {
        margin: '0',
        flexGrow: '2',
        flexShrink: '0',
        display: 'block',
        whiteSpace: 'pre',
        wordWrap: 'normal',
        boxSizing: 'border-box',
        padding: '4px 0',
        outline: 'none',
        minHeight: '120px'
      },
      '.cm-lineWrapping': {
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere'
      },
      '.cm-line': {
        display: 'block',
        padding: '0 2px 0 6px'
      },
      '.cm-gutters': {
        flexShrink: '0',
        display: 'flex',
        height: '100%',
        boxSizing: 'border-box',
        left: '0',
        zIndex: '200'
      },
      '.cm-gutter': {
        display: 'flex !important',
        flexDirection: 'column',
        flexShrink: '0',
        boxSizing: 'border-box',
        minHeight: '100%',
        overflow: 'hidden'
      },
      '.cm-gutterElement': {
        boxSizing: 'border-box'
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 3px 0 5px',
        minWidth: '20px',
        textAlign: 'right',
        color: '#999',
        whiteSpace: 'nowrap'
      }
    }),
    // Custom theme for appearance - matching visualizer style
    EditorView.theme({
      '&.cm-editor': {
        fontSize: '14px',
        fontFamily: "'Courier New', Courier, monospace",
        border: '1px solid rgba(102, 126, 234, 0.25)',
        borderRadius: '12px',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.5)',
        overflow: 'hidden'
      },
      '.cm-content': {
        minHeight: '120px',
        padding: '8px',
        caretColor: '#000'
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-editor.cm-focused': {
        borderColor: '#667eea',
        backgroundColor: '#fff',
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 0 0 2px rgba(102, 126, 234, 0.2)'
      },
      '.cm-placeholder': {
        color: '#999',
        fontStyle: 'italic',
      },
      '.cm-gutters': {
        backgroundColor: 'rgba(245, 245, 245, 0.5)',
        color: '#999',
        border: 'none',
        borderRight: '1px solid rgba(102, 126, 234, 0.15)'
      }
    })
  ];
  extensions.push(highlightField);

  // Add theme if dark mode
  if (theme === 'dark') {
    extensions.push(oneDark);
  }

  // Add line numbers option
  if (!lineNumbers) {
    extensions.push(EditorView.lineWrapping);
  }

  // Create editor - wrap in try-catch to handle errors gracefully
  let editor;
  try {
    editor = new EditorView({
      doc: initialValue,
      extensions
      // Don't set parent here - we'll insert manually
    });

    // Hide textarea and insert editor before it
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(editor.dom, textarea);
    
    console.log(`   Editor DOM created and inserted for ${textarea.id || 'textarea'}`);
  } catch (error) {
    console.error('❌ Error creating Strudel REPL editor:', error);
    console.error('   Error details:', error.message, error.stack);
    // If editor creation fails, just use the textarea as-is
    return null;
  }


  // Expose methods to get/set value (only if editor was created successfully)
  if (editor) {
    editor.getTextarea = () => textarea;
    editor.getValue = () => editor.state.doc.toString();
    editor.setValue = (value) => {
      const currentValue = editor.state.doc.toString();
      if (currentValue !== value) {
        editor.dispatch({
          changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: value || ''
          }
        });
        // Also update textarea directly
        textarea.value = value || '';
        // Trigger input event
        const event = new Event('input', { bubbles: true });
        textarea.dispatchEvent(event);
      }
    };
  }

  // Autofocus if requested
  if (autofocus) {
    editor.focus();
  }

  return editor;
}

/**
 * Initialize Strudel REPL editors on all textareas with data-strudel-repl attribute
 */
export function initStrudelReplEditors() {
  try {
    console.log('🎨 Initializing Strudel REPL editors...');
    const textareas = document.querySelectorAll('textarea[data-strudel-repl], #modal-pattern, #master-pattern');
    console.log(`   Found ${textareas.length} textareas to initialize:`, Array.from(textareas).map(t => t.id || 'unnamed'));
    
    textareas.forEach((textarea) => {
      if (textarea.tagName === 'TEXTAREA' && !textarea.dataset.strudelReplInitialized) {
        const isModal = textarea.id === 'modal-pattern';
        const isMaster = textarea.id === 'master-pattern';
        
        console.log(`   Initializing editor for: ${textarea.id || 'unnamed textarea'}`);
        
        // Get placeholder from textarea
        const placeholder = textarea.placeholder || '';
        
        // Create editor
        try {
          const editor = createStrudelReplEditor(textarea, {
            theme: 'light',
            placeholder,
            lineNumbers: true,
            autofocus: false,
            onUpdate: (value) => {
              // Update textarea value for compatibility
              textarea.value = value;
            }
          });

          // Only mark as initialized if editor was created successfully
          if (editor) {
            textarea.dataset.strudelReplInitialized = 'true';
            textarea._strudelEditor = editor;
            
            // Store in global map for easy access
            editorInstances.set(textarea.id, editor);
            
            console.log(`   ✅ Successfully created editor for ${textarea.id || 'textarea'}`);
          } else {
            console.warn(`   ⚠️ Editor creation returned null for ${textarea.id || 'textarea'}`);
          }
        } catch (editorError) {
          console.error(`   ❌ Error creating editor for ${textarea.id || 'textarea'}:`, editorError);
        }
      } else if (textarea.dataset.strudelReplInitialized) {
        console.log(`   ⏭️ Skipping ${textarea.id || 'unnamed'} - already initialized`);
      }
    });
    console.log('✅ Strudel REPL editors initialization complete');
  } catch (error) {
    console.error('❌ Error initializing Strudel REPL editors:', error);
    // Continue without editors - textareas will work as fallback
  }
}

/**
 * Get the CodeMirror editor instance for a textarea
 * @param {HTMLTextAreaElement|string} textareaOrId - The textarea element or its ID
 * @returns {EditorView|null} - The editor instance or null
 */
export function getStrudelEditor(textareaOrId) {
  const textarea = typeof textareaOrId === 'string' 
    ? document.getElementById(textareaOrId)
    : textareaOrId;
  
  if (!textarea) return null;
  
  return textarea._strudelEditor || null;
}

/**
 * Get the value from a Strudel REPL editor
 * @param {HTMLTextAreaElement|string} textareaOrId - The textarea element or its ID
 * @returns {string} - The editor value
 */
export function getStrudelEditorValue(textareaOrId) {
  const editor = getStrudelEditor(textareaOrId);
  if (editor && editor.getValue) {
    return editor.getValue();
  }
  
  const textarea = typeof textareaOrId === 'string' 
    ? document.getElementById(textareaOrId)
    : textareaOrId;
  
  return textarea ? textarea.value : '';
}

/**
 * Set the value in a Strudel REPL editor
 * @param {HTMLTextAreaElement|string} textareaOrId - The textarea element or its ID
 * @param {string} value - The value to set
 */
export function setStrudelEditorValue(textareaOrId, value) {
  const editor = getStrudelEditor(textareaOrId);
  if (editor && editor.setValue) {
    editor.setValue(value);
    return;
  }
  
  const textarea = typeof textareaOrId === 'string' 
    ? document.getElementById(textareaOrId)
    : textareaOrId;
  
  if (textarea) {
    textarea.value = value;
    // Trigger input event
    const event = new Event('input', { bubbles: true });
    textarea.dispatchEvent(event);
  }
}

/**
 * Enable or disable editing for a Strudel REPL editor
 * @param {HTMLTextAreaElement|string} textareaOrId - The textarea element or its ID
 * @param {boolean} editable - Whether the editor should be editable
 */
export function setStrudelEditorEditable(textareaOrId, editable) {
  const editor = getStrudelEditor(textareaOrId);
  const textarea = typeof textareaOrId === 'string'
    ? document.getElementById(textareaOrId)
    : textareaOrId;

  if (editor && editor.contentDOM) {
    editor.contentDOM.setAttribute('contenteditable', editable ? 'true' : 'false');
    editor.dom.classList.toggle('cm-readonly', !editable);
  }

  if (textarea) {
    textarea.readOnly = !editable;
    textarea.classList.toggle('pattern-editor-readonly', !editable);
  }
}

export function setStrudelEditorHighlights(textareaOrId, ranges = []) {
  const editor = getStrudelEditor(textareaOrId);
  if (!editor) {
    return;
  }

  const doc = editor.state.doc;
  const decorationRanges = [];

  if (Array.isArray(ranges)) {
    ranges.forEach(range => {
      if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') {
        return;
      }
      const from = Math.max(0, Math.min(doc.length, Math.floor(range.from)));
      const to = Math.max(from, Math.min(doc.length, Math.ceil(range.to)));
      if (from === to) {
        return;
      }
      decorationRanges.push(highlightDecoration.range(from, to));
    });
  }

  const decorations = decorationRanges.length > 0
    ? Decoration.set(decorationRanges.sort((a, b) => a.from - b.from))
    : Decoration.none;

  editor.dispatch({
    effects: setHighlightsEffect.of(decorations)
  });
}

/**
 * Insert a snippet into a Strudel editor at the current cursor position.
 * Falls back to textarea operations if CodeMirror is unavailable.
 * @param {HTMLTextAreaElement|string} textareaOrId
 * @param {string} snippet
 * @param {{ cursorOffset?: number }} options
 */
export function insertStrudelEditorSnippet(textareaOrId, snippet, options = {}) {
  if (!snippet || typeof snippet !== 'string') {
    return;
  }

  const requestedCursorOffset =
    typeof options.cursorOffset === 'number' ? options.cursorOffset : null;

  const editor = getStrudelEditor(textareaOrId);
  if (editor) {
    const view = editor;
    const { state } = view;
    const selection = state.selection.main;
    const from = selection.from;
    const to = selection.to;

    const finalSnippet = prepareSnippetWithDot(snippet, () => {
      let pos = from;
      while (pos > 0) {
        const ch = state.doc.sliceString(pos - 1, pos);
        pos -= 1;
        if (!/\s/.test(ch)) {
          return ch;
        }
      }
      return '';
    });

    const autoCursorOffset =
      requestedCursorOffset !== null
        ? requestedCursorOffset
        : (finalSnippet.endsWith('()') || finalSnippet.endsWith('{}') ? 1 : 0);

    view.dispatch({
      changes: { from, to, insert: finalSnippet },
      selection: EditorSelection.cursor(
        Math.max(from + finalSnippet.length - autoCursorOffset, 0)
      ),
      scrollIntoView: true
    });

    view.focus();
    return;
  }

  const textarea =
    typeof textareaOrId === 'string'
      ? document.getElementById(textareaOrId)
      : textareaOrId;

  if (!textarea) {
    return;
  }

  const start =
    typeof textarea.selectionStart === 'number'
      ? textarea.selectionStart
      : textarea.value.length;
  const end =
    typeof textarea.selectionEnd === 'number'
      ? textarea.selectionEnd
      : textarea.value.length;

  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);

  const finalSnippet = prepareSnippetWithDot(snippet, () => {
    let pos = start;
    while (pos > 0) {
      const ch = textarea.value.charAt(pos - 1);
      pos -= 1;
      if (!/\s/.test(ch)) {
        return ch;
      }
    }
    return '';
  });

  textarea.value = `${before}${finalSnippet}${after}`;

  const autoCursorOffset =
    requestedCursorOffset !== null
      ? requestedCursorOffset
      : (finalSnippet.endsWith('()') || finalSnippet.endsWith('{}') ? 1 : 0);

  const cursorPos = Math.max(start + finalSnippet.length - autoCursorOffset, 0);
  if (typeof textarea.setSelectionRange === 'function') {
    textarea.setSelectionRange(cursorPos, cursorPos);
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function prepareSnippetWithDot(snippet, getPrecedingChar) {
  if (!snippet) {
    return snippet;
  }

  const trimmedSnippet = snippet.trimStart();
  if (trimmedSnippet.startsWith('.') || /^\s/.test(snippet)) {
    return snippet;
  }

  const precedingChar =
    typeof getPrecedingChar === 'function' ? getPrecedingChar() : '';
  if (!precedingChar) {
    return snippet;
  }

  if (precedingChar === '.' || /\s/.test(precedingChar)) {
    return snippet;
  }

  if (/[\(\[\{,]/.test(precedingChar)) {
    return snippet;
  }

  return `.${snippet}`;
}

