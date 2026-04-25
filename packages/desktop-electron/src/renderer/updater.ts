import { initI18n, t } from "./i18n"
import { api } from "./api"

export const UPDATER_ENABLED = () => window.__OPENCODE__?.updaterEnabled ?? false

export async function runUpdater({ alertOnFail }: { alertOnFail: boolean }) {
  await initI18n()
  try {
    await api.runUpdater(alertOnFail)
  } catch {
    if (alertOnFail) {
      window.alert(t("desktop.updater.checkFailed.message"))
    }
  }
}
