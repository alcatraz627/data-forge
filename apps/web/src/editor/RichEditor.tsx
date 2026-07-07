import Image from '@tiptap/extension-image';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { uploadAttachment } from '../api';
import { flashNotice } from '../store';

interface MarkdownStorage {
  markdown: { getMarkdown(): string };
}

/** TipTap-backed rich editing. Content enters and leaves as markdown (the
 * canonical on-disk format); this file is an implementation detail of
 * NoteEditor and tiptap types must not leak outside this directory.
 * Pasted or dropped images upload to the content-addressed attachment store
 * and embed as a stable markdown image reference. */
export default function RichEditor({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (markdown: string) => void;
  autoFocus: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Markdown.configure({ transformPastedText: true }),
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      handlePaste: (_view, event) => uploadFromDataTransfer(event.clipboardData),
      handleDrop: (_view, event) => uploadFromDataTransfer((event as DragEvent).dataTransfer),
    },
    onUpdate: ({ editor: e }) => {
      onChange((e.storage as unknown as MarkdownStorage).markdown.getMarkdown());
    },
  });

  /** Returns true (handled) when the transfer holds an image we're uploading,
   * so the default paste/drop of raw binary is suppressed. */
  function uploadFromDataTransfer(dt: DataTransfer | null): boolean {
    const file = [...(dt?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file || !editor) return false;
    uploadAttachment(file)
      .then((url) => editor.chain().focus().setImage({ src: url }).run())
      .catch(() => flashNotice('Image upload needs a connection'));
    return true;
  }

  return <EditorContent className="rich-editor" editor={editor} />;
}
