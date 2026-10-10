'use client'

import { useTranslations } from 'next-intl'
import { useOptimistic, useState, useTransition } from 'react'
import { PreferenceRow } from '@/components/preference-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BROWSER_LANGUAGE, LANGUAGE_NAME, LANGUAGES, type Language } from '@/i18n/config'
import { setLanguagePreferenceAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

/**
 * The language the interface speaks. A list rather than tabs: the languages
 * are meant to grow, and a row of tabs would not hold them. Sent on the
 * change, without a form, like the other preferences beside it. The example
 * writes a day and an amount the way the current language does, which is what
 * changes besides the words.
 */
export function LanguagePreference({ value, today }: { value: Language | null; today: string }) {
  const t = useTranslations('settings.language')
  const format = useFormat()
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  const [chosen, showChosen] = useOptimistic<string>(value ?? BROWSER_LANGUAGE)

  return (
    <PreferenceRow
      label={t('label')}
      example={`${format.dateLong(today)} · ${format.eur(1234.5, 2)}`}
      control={
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Select
            value={chosen}
            disabled={pending}
            onValueChange={(next) =>
              startTransition(async () => {
                showChosen(next)
                setFailed(await setLanguagePreferenceAction(next))
              })
            }
          >
            <SelectTrigger aria-label={t('label')} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BROWSER_LANGUAGE}>{t('browser')}</SelectItem>
              {LANGUAGES.map((language) => (
                // A language named in itself is still announced in it.
                <SelectItem key={language} value={language} lang={language}>
                  {LANGUAGE_NAME[language]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {failed && <span className="text-[11px] text-destructive">{failed}</span>}
        </div>
      }
    />
  )
}
