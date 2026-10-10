import { auth } from '@abacus/core/auth'
import { languagePreference } from '@abacus/core/services/preferences'
import { headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_LANGUAGE, type Language, negotiateLanguage } from '@/i18n/config'
import type { Messages } from '@/i18n/messages/fr'

/**
 * The language of a request: the one the person chose in their preferences,
 * else the one their browser asks for, else the default. Pages outside the
 * session (sign-in, consent) have only the browser to go by.
 *
 * Nothing about the language lives in the URL or a cookie: the preference is
 * the one place it is written, and the MCP writes the same one.
 */
async function requestLanguage(): Promise<Language> {
  const all = await headers()
  const session = await auth.api.getSession({ headers: all })
  const chosen = session ? await languagePreference(session.user.id) : null
  return chosen ?? negotiateLanguage(all.get('accept-language')) ?? DEFAULT_LANGUAGE
}

const CATALOGS: Record<Language, () => Promise<{ default: Messages }>> = {
  fr: () => import('@/i18n/messages/fr'),
  en: () => import('@/i18n/messages/en'),
}

export default getRequestConfig(async () => {
  const locale = await requestLanguage()
  return { locale, messages: (await CATALOGS[locale]()).default }
})
