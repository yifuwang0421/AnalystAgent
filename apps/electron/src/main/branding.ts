import { app } from 'electron'
import { join } from 'node:path'

export const ANALYST_APP_NAME = process.env.ANALYST_APP_NAME
  || process.env.CRAFT_APP_NAME
  || 'Analyst Agent'

export const ANALYST_APP_ID = 'com.analystagent.desktop'

export const ANALYST_DEEPLINK_SCHEME = process.env.ANALYST_DEEPLINK_SCHEME
  || process.env.CRAFT_DEEPLINK_SCHEME
  || 'analystagent'

let electronBrandingConfigured = false

export function ensureElectronBranding(): void {
  if (electronBrandingConfigured) return
  electronBrandingConfigured = true

  app.setName(ANALYST_APP_NAME)

  if (process.platform === 'win32') {
    app.setAppUserModelId(ANALYST_APP_ID)
  }

  app.setPath(
    'userData',
    process.env.ANALYST_USER_DATA_DIR || join(app.getPath('appData'), 'AnalystAgent')
  )
}
