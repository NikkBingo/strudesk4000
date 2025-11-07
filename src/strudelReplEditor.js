/**
 * Strudel REPL Editor - CodeMirror integration for Strudel patterns
 * Provides syntax highlighting, autocomplete, and Strudel REPL features
 */

import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, foldKeymap, bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';

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
    lineNumbers = true,
    autofocus = false,
    onUpdate = null
  } = options;

  // Get initial value from textarea
  const initialValue = textarea.value || '';

  // Create extensions
  const extensions = [
    lineNumbers(),
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
    EditorView.theme({
      '&.cm-editor': {
        fontSize: '14px',
        fontFamily: "'Courier New', Courier, monospace",
      },
      '.cm-content': {
        minHeight: '120px',
        padding: '8px',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-editor.cm-focused': {
        outline: '2px solid #667eea',
        outlineOffset: '-2px',
      },
      '.cm-placeholder': {
        color: '#999',
        fontStyle: 'italic',
      },
    })
  ];

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
      extensions,
      parent: textarea.parentNode
    });

    // Replace textarea with editor
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(editor.dom, textarea);
  } catch (error) {
    console.error('❌ Error creating Strudel REPL editor:', error);
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
    const textareas = document.querySelectorAll('textarea[data-strudel-repl], #modal-pattern, #master-pattern');
    
    textareas.forEach((textarea) => {
      if (textarea.tagName === 'TEXTAREA' && !textarea.dataset.strudelReplInitialized) {
        const isModal = textarea.id === 'modal-pattern';
        const isMaster = textarea.id === 'master-pattern';
        
        // Get placeholder from textarea
        const placeholder = textarea.placeholder || '';
        
        // Create editor
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
          console.log(`✅ Initialized Strudel REPL editor for ${textarea.id || 'textarea'}`);
        } else {
          console.warn(`⚠️ Failed to initialize Strudel REPL editor for ${textarea.id || 'textarea'}, using textarea as fallback`);
        }
      }
    });
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

