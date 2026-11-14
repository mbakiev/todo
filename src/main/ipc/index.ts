import type { AppContext } from '../context'
import { registerAppHandlers } from './app'
import { registerDataHandlers } from './data'
import { registerSettingsHandlers } from './settings'
import { registerTagHandlers } from './tags'
import { registerTaskHandlers } from './tasks'

export function registerIpcHandlers(ctx: AppContext): void {
  registerTaskHandlers(ctx)
  registerTagHandlers(ctx)
  registerSettingsHandlers(ctx)
  registerDataHandlers(ctx)
  registerAppHandlers(ctx)
}
