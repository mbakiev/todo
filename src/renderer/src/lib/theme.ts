import { useEffect, useSyncExternalStore } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'

const query = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

function subscribeSystem(cb: () => void): () => void {
  const mq = query()
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** 'light' | 'dark' after resolving settings.theme === 'system' against the OS. */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSettingsStore((s) => s.settings.theme)
  const systemDark = useSyncExternalStore(subscribeSystem, () => query().matches)
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

/** Keeps `<html class="dark">` in sync with the resolved theme. Mount once per window. */
export function useApplyTheme(): void {
  const resolved = useResolvedTheme()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])
}
