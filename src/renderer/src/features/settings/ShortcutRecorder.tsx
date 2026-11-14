// Records a global shortcut: click, press the combo. Shows platform symbols (⌥⇧T on macOS,
// Alt+Shift+T on Windows, via lib/shortcuts), requires a non-Shift modifier, Esc cancels. While recording,
// the app's own global shortcuts are suspended so the current combo can be re-recorded.
import { useEffect, useRef, useState } from 'react'
import { recordFromKeyEvent, type Modifier } from '@shared/accelerators'
import { api } from '@/lib/api'
import { appInfo, isMac } from '@/lib/platform'
import { formatModifier, shortcutParts } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { KeyCombo } from './parts'

export interface ShortcutRecorderProps {
  value: string
  onChange(accelerator: string): void
  /** Returns an error message if the combo cannot be used (e.g. taken by the other shortcut). */
  validate?(accelerator: string): string | null
  label: string
  invalid?: boolean
}

export function ShortcutRecorder({
  value,
  onChange,
  validate,
  label,
  invalid,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [held, setHeld] = useState<Modifier[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const platform = appInfo().platform
  const mac = isMac()
  // Latest callbacks without re-running the recording effect on every parent render.
  const onChangeRef = useRef(onChange)
  const validateRef = useRef(validate)
  useEffect(() => {
    onChangeRef.current = onChange
    validateRef.current = validate
  })

  useEffect(() => {
    if (!recording) return
    void api().app.setGlobalShortcutsSuspended(true)
    const stop = (): void => {
      setRecording(false)
      setHeld([])
    }
    // Window + capture phase: runs before Radix's Esc handler (document capture), so Esc
    // cancels the recording instead of closing the Settings dialog.
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const r = recordFromKeyEvent(e, platform)
      if (r.kind === 'pending') {
        setHeld(r.modifiers)
      } else if (r.kind === 'cancel') {
        setHint(null)
        stop()
      } else if (r.kind === 'invalid') {
        setHint(
          r.reason === 'needs-modifier'
            ? mac
              ? 'Include ⌃, ⌥ or ⌘ in the shortcut'
              : 'Include Ctrl, Alt or Win in the shortcut'
            : 'That key cannot be used in a shortcut',
        )
      } else {
        const problem = validateRef.current?.(r.accelerator) ?? null
        if (problem) {
          setHint(problem)
          return
        }
        setHint(null)
        stop()
        onChangeRef.current(r.accelerator)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      // On keyup the released modifier's flag is already false.
      const r = recordFromKeyEvent(e, platform)
      if (r.kind === 'pending') setHeld(r.modifiers)
    }
    const onBlur = (): void => stop()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      void api().app.setGlobalShortcutsSuspended(false)
    }
  }, [recording, platform, mac])

  const parts = shortcutParts(value)
  const heldLabel = held.map(formatModifier)

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`${label} shortcut`}
        data-recording={recording || undefined}
        onClick={() => {
          setHint(null)
          setRecording((r) => !r)
        }}
        className={cn(
          'flex h-8 min-w-36 items-center justify-center gap-1 rounded-md border bg-background px-2 text-xs outline-none',
          'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
          recording && 'border-primary ring-[3px] ring-primary/20',
          invalid && !recording && 'border-destructive/60',
        )}
      >
        {recording ? (
          heldLabel.length > 0 ? (
            <KeyCombo parts={[...heldLabel, '…']} />
          ) : (
            <span className="text-primary">Press shortcut…</span>
          )
        ) : parts.length > 0 ? (
          <KeyCombo parts={parts} />
        ) : (
          <span className="text-muted-foreground">Not set</span>
        )}
      </button>
      {recording && (
        <span className={cn('text-[11px]', hint ? 'text-destructive' : 'text-muted-foreground')}>
          {hint ?? 'Esc to cancel'}
        </span>
      )}
    </div>
  )
}
