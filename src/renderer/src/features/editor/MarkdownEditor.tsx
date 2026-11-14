// PLACEHOLDER — owned by the task-detail+editor feature. Replace with the Tiptap editor
// (spec §7 "Description editor"), keeping the export name and props. Value is Markdown (GFM).
import { Textarea } from '@/components/ui/textarea'

export interface MarkdownEditorProps {
  /** Markdown source. */
  value: string
  /** Called with the new Markdown. Callers debounce/flush; the editor reports every change. */
  onChange(markdown: string): void
  placeholder?: string
  /** Called when the editor loses focus (flush point for autosave). */
  onBlur?(): void
  className?: string
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  onBlur,
  className,
}: MarkdownEditorProps) {
  return (
    <Textarea
      value={value}
      placeholder={placeholder ?? 'Add a description…'}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={className ?? 'min-h-40 resize-none font-mono text-[13px]'}
    />
  )
}
