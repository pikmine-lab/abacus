import { getTranslations } from 'next-intl/server'
import { getFormat } from '@/lib/format-server'
import { type LevyWords, levyWords } from '@/lib/levy-words'

/** The levy words of the language this request speaks, in an async server component. */
export async function getLevyWords(): Promise<LevyWords> {
  return levyWords(await getTranslations('regime.words'), await getFormat())
}
