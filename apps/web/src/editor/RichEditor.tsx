import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

interface MarkdownStorage {
  markdown: { getMarkdown(): string };
}

/** TipTap-backed rich editing. Content enters and leaves as markdown (the
 * canonical on-disk format); this file is an implementation detail of
 * NoteEditor and tiptap types must not leak outside this directory. */
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
      Markdown.configure({ transformPastedText: true }),
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor: e }) => {
      onChange((e.storage as unknown as MarkdownStorage).markdown.getMarkdown());
    },
  });
  return <EditorContent className="rich-editor" editor={editor} />;
}
