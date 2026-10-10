import type { Language } from '@/i18n/config'
import type { Messages as Catalog } from '@/i18n/messages/fr'

// Keys are typed on the French catalog: a key missing there does not compile,
// and the other catalogs are held to the same shape (see messages/en).
declare module 'next-intl' {
  interface AppConfig {
    Locale: Language
    Messages: Catalog
  }
}
