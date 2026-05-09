import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  DecoratorNode,
  createCommand,
  type EditorConfig,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';

export type PromptReference = {
  key: string;
  label: string;
  imageUrl: string;
};

export type PromptLexicalEditorHandle = {
  insertReference: (label: string) => void;
  focus: () => void;
};

type SerializedReferenceNode = Spread<
  {
    label: string;
    imageUrl: string;
    refKey: string;
  },
  SerializedLexicalNode
>;

const INSERT_REFERENCE_COMMAND: LexicalCommand<string> = createCommand('INSERT_REFERENCE_COMMAND');

const mentionPattern = /@Image\s+\d+/g;

const referencePillStyle = (hovered: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  maxWidth: 172,
  padding: hovered ? '3px 7px 3px 4px' : '3px 8px 3px 4px',
  margin: '0 2px',
  borderRadius: 7,
  border: hovered ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
  background: hovered ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.08)',
  color: '#f8fafc',
  fontSize: 18,
  fontWeight: 760,
  lineHeight: 1,
  verticalAlign: '-4px',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
  userSelect: 'none',
});

const removeButtonStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

const ReferenceChip: React.FC<{
  label: string;
  imageUrl: string;
  nodeKey: NodeKey;
}> = ({ label, imageUrl, nodeKey }) => {
  const [editor] = useLexicalComposerContext();
  const [hovered, setHovered] = useState(false);

  const remove = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      node?.remove();
    });
  }, [editor, nodeKey]);

  return (
    <span
      contentEditable={false}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={referencePillStyle(hovered)}
    >
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        style={{ width: 20, height: 20, borderRadius: 5, objectFit: 'cover', flex: '0 0 auto' }}
      />
      {hovered && (
        <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={remove} style={removeButtonStyle}>
          ×
        </button>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  );
};

class ReferenceNode extends DecoratorNode<React.ReactNode> {
  __label: string;
  __imageUrl: string;
  __refKey: string;

  static getType(): string {
    return 'reference';
  }

  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.__label, node.__imageUrl, node.__refKey, node.__key);
  }

  static importJSON(serializedNode: SerializedReferenceNode): ReferenceNode {
    return new ReferenceNode(serializedNode.label, serializedNode.imageUrl, serializedNode.refKey);
  }

  constructor(label: string, imageUrl: string, refKey: string, key?: NodeKey) {
    super(key);
    this.__label = label;
    this.__imageUrl = imageUrl;
    this.__refKey = refKey;
  }

  exportJSON(): SerializedReferenceNode {
    return {
      type: 'reference',
      version: 1,
      label: this.__label,
      imageUrl: this.__imageUrl,
      refKey: this.__refKey,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.verticalAlign = 'baseline';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return `@${this.__label}`;
  }

  decorate(): React.ReactNode {
    return <ReferenceChip label={this.__label} imageUrl={this.__imageUrl} nodeKey={this.__key} />;
  }
}

const $createReferenceNode = (reference: PromptReference): ReferenceNode =>
  new ReferenceNode(reference.label, reference.imageUrl, reference.key);

const getReferenceByLabel = (references: PromptReference[], label: string) =>
  references.find((reference) => reference.label === label);

const writePromptToEditor = (editor: LexicalEditor, value: string, references: PromptReference[]) => {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const lines = String(value || '').split('\n');
    const safeLines = lines.length > 0 ? lines : [''];

    safeLines.forEach((line) => {
      const paragraph = $createParagraphNode();
      let cursor = 0;
      const matches = Array.from(line.matchAll(mentionPattern));

      matches.forEach((match) => {
        const raw = match[0];
        const index = match.index || 0;
        if (index > cursor) {
          paragraph.append($createTextNode(line.slice(cursor, index)));
        }
        const label = raw.slice(1);
        const reference = getReferenceByLabel(references, label);
        if (reference) {
          paragraph.append($createReferenceNode(reference));
        } else {
          paragraph.append($createTextNode(raw));
        }
        cursor = index + raw.length;
      });

      if (cursor < line.length) {
        paragraph.append($createTextNode(line.slice(cursor)));
      }
      root.append(paragraph);
    });
  }, { discrete: true });
};

const serializeEditor = (): string => {
  const root = $getRoot();
  return root.getChildren().map((child) => child.getTextContent()).join('\n');
};

const EditorBridgePlugin = forwardRef<PromptLexicalEditorHandle, {
  value: string;
  references: PromptReference[];
  onChange: (value: string) => void;
}>(({ value, references, onChange }, ref) => {
  const [editor] = useLexicalComposerContext();
  const valueRef = useRef(value);
  const referencesRef = useRef(references);
  const referencesSignature = useMemo(
    () => references.map((reference) => `${reference.key}:${reference.label}:${reference.imageUrl}`).join('|'),
    [references],
  );

  useEffect(() => {
    referencesRef.current = references;
  }, [references]);

  useEffect(() => {
    referencesRef.current = references;
    writePromptToEditor(editor, valueRef.current, references);
  }, [editor, referencesSignature]);

  useEffect(() => {
    if (value === valueRef.current) return;
    valueRef.current = value;
    writePromptToEditor(editor, value, referencesRef.current);
  }, [editor, value]);

  useImperativeHandle(ref, () => ({
    insertReference(label: string) {
      editor.dispatchCommand(INSERT_REFERENCE_COMMAND, label);
      editor.focus();
    },
    focus() {
      editor.focus();
    },
  }), [editor]);

  useEffect(() => editor.registerCommand(
    INSERT_REFERENCE_COMMAND,
    (label) => {
      const reference = getReferenceByLabel(referencesRef.current, label);
      if (!reference) return false;
      editor.update(() => {
        const selection = $getSelection();
        const nodes = [$createReferenceNode(reference), $createTextNode(' ')];
        if ($isRangeSelection(selection)) {
          selection.insertNodes(nodes);
        } else {
          const root = $getRoot();
          const paragraph = root.getLastChild() || $createParagraphNode();
          if (!paragraph.getParent()) root.append(paragraph);
          paragraph.append(...nodes);
        }
      });
      return true;
    },
    COMMAND_PRIORITY_EDITOR,
  ), [editor]);

  return (
    <OnChangePlugin
      ignoreHistoryMergeTagChange
      onChange={(editorState) => {
        editorState.read(() => {
          const nextValue = serializeEditor();
          if (nextValue === valueRef.current) return;
          valueRef.current = nextValue;
          onChange(nextValue);
        });
      }}
    />
  );
});

EditorBridgePlugin.displayName = 'EditorBridgePlugin';

interface PromptLexicalEditorProps {
  value: string;
  references: PromptReference[];
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  placeholder?: string;
}

export const PromptLexicalEditor = forwardRef<PromptLexicalEditorHandle, PromptLexicalEditorProps>(({
  value,
  references,
  onChange,
  onKeyDown,
  placeholder = '描述任何你想要生成的内容，按 @ 引用素材',
}, ref) => {
  const initialConfig = useMemo(() => ({
    namespace: 'FlowPromptEditor',
    nodes: [ReferenceNode],
    onError(error: Error) {
      throw error;
    },
    editorState(editor: LexicalEditor) {
      writePromptToEditor(editor, value, references);
    },
    theme: {},
  }), []);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div style={{ position: 'relative', minHeight: 118, maxHeight: 400 }}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="nodrag nopan nowheel sleek-scroll-y flow-rich-prompt-editor"
              onKeyDown={onKeyDown}
              style={{
                width: '100%',
                minHeight: 118,
                maxHeight: 400,
                overflowY: 'auto',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#f8fafc',
                fontSize: 20,
                lineHeight: 1.42,
                fontWeight: 400,
                fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                caretColor: '#fff',
              }}
            />
          }
          placeholder={
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              color: 'rgba(255,255,255,0.28)',
              fontSize: 20,
              lineHeight: 1.42,
              pointerEvents: 'none',
              fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
            }}>
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorBridgePlugin ref={ref} value={value} references={references} onChange={onChange} />
      </div>
    </LexicalComposer>
  );
});

PromptLexicalEditor.displayName = 'PromptLexicalEditor';
