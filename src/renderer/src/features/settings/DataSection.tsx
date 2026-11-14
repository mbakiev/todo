import { Download, FolderOpen, HardDriveDownload, Upload } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { APP_DISPLAY_NAME, BACKUP_KEEP } from '@shared/constants'
import type { BackupInfo, ImportResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { useTags, useTasks } from '@/stores/selectors'
import { ResultNote, SectionHeading } from './parts'

type Busy = 'export' | 'merge' | 'replace' | 'backup' | null
interface Outcome {
  area: 'export' | 'import' | 'backup'
  tone: 'default' | 'error'
  text: ReactNode
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function describeImport(r: ImportResult): string {
  const tasks =
    r.mode === 'replace'
      ? `Replaced everything with ${plural(r.tasksAdded, 'task')} and ${plural(r.tagsAdded, 'tag')}.`
      : `Merged: ${r.tasksAdded} added, ${r.tasksUpdated} updated, ${r.tasksSkipped} unchanged · tags: ${r.tagsAdded} added, ${r.tagsUpdated} updated.`
  return r.backupPath ? `${tasks} Previous data backed up to ${r.backupPath}` : tasks
}

function ActionRow({
  title,
  description,
  children,
  outcome,
}: {
  title: string
  description: ReactNode
  children: ReactNode
  outcome?: Outcome | null
}) {
  return (
    <section className="py-4 first:pt-0">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <SectionHeading title={title} description={description} />
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {outcome && <ResultNote tone={outcome.tone}>{outcome.text}</ResultNote>}
    </section>
  )
}

export function DataSection() {
  const tasks = useTasks()
  const tags = useTags()
  const [busy, setBusy] = useState<Busy>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [backup, setBackup] = useState<BackupInfo | null>(null)

  const refreshBackup = useCallback(async () => {
    try {
      setBackup(await api().data.getBackupInfo())
    } catch {
      setBackup(null)
    }
  }, [])
  useEffect(() => {
    let alive = true
    api()
      .data.getBackupInfo()
      .then((info) => alive && setBackup(info))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const run = async (
    kind: Exclude<Busy, null>,
    area: Outcome['area'],
    fn: () => Promise<ReactNode | null>,
  ) => {
    setBusy(kind)
    try {
      const text = await fn()
      if (text !== null) setOutcome({ area, tone: 'default', text })
    } catch (err) {
      setOutcome({ area, tone: 'error', text: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const doExport = () =>
    run('export', 'export', async () => {
      const counts = `${plural(tasks.length, 'task')} and ${plural(tags.length, 'tag')}`
      const res = await api().data.exportToFile()
      return res ? `Exported ${counts} to ${res.path}` : null
    })

  const doImport = (mode: 'merge' | 'replace') =>
    run(mode, 'import', async () => {
      const res = await api().data.importFromFile(mode)
      if (res?.backupPath) void refreshBackup()
      return res ? describeImport(res) : null
    })

  const doBackup = () =>
    run('backup', 'backup', async () => {
      const res = await api().data.backupNow()
      void refreshBackup()
      return `Backed up to ${res.path}`
    })

  const forArea = (area: Outcome['area']): Outcome | null =>
    outcome?.area === area ? outcome : null

  return (
    <div className="divide-y">
      <ActionRow
        title="Export"
        description="Save every task and tag to a JSON file you can keep or import elsewhere."
        outcome={forArea('export')}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void doExport()}
        >
          <Download className="size-3.5" />
          Export…
        </Button>
      </ActionRow>

      <ActionRow
        title="Import"
        description={
          <>
            <b className="font-medium text-foreground/80">Merge</b> adds new tasks and keeps the
            newer copy of tasks you already have.{' '}
            <b className="font-medium text-foreground/80">Replace all</b> swaps everything for the
            file’s contents. Either way, a backup of the current data is taken first.
          </>
        }
        outcome={forArea('import')}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void doImport('merge')}
        >
          <Upload className="size-3.5" />
          Merge…
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmReplace(true)}
        >
          Replace all…
        </Button>
      </ActionRow>

      <ActionRow
        title="Backups"
        description={
          <>
            Taken automatically at startup and every 24 hours (newest {BACKUP_KEEP.auto} kept);
            &ldquo;Back up now&rdquo; copies are kept separately (newest {BACKUP_KEEP.manual}).
            <br />
            <span data-testid="last-backup">
              {backup?.latest
                ? `Last backup: ${formatTime(backup.latest.createdAt)} · ${plural(backup.count, 'backup')} kept`
                : 'No backups yet.'}
            </span>
          </>
        }
        outcome={forArea('backup')}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void doBackup()}
        >
          <HardDriveDownload className="size-3.5" />
          Back up now
        </Button>
      </ActionRow>

      <ActionRow title="Data folder" description="Where the database lives on this computer.">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void api()
              .data.revealDataFolder()
              .catch((err: unknown) =>
                setOutcome({ area: 'backup', tone: 'error', text: errorMessage(err) }),
              )
          }
        >
          <FolderOpen className="size-3.5" />
          Reveal data folder
        </Button>
      </ActionRow>

      <Dialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">Replace all data?</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Every task and tag in {APP_DISPLAY_NAME} ({plural(tasks.length, 'task')},{' '}
              {plural(tags.length, 'tag')}) will be replaced by the contents of the file you choose.
              A backup of the current data is taken first, so you can get it back from the backups
              folder.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmReplace(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmReplace(false)
                void doImport('replace')
              }}
            >
              Choose file and replace…
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
