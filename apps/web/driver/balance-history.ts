import type { Steps } from '@abacus/use-case-language'
import { moneyOf, type WebContext } from './context.ts'

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** "1 juin 2026", the tooltip's long date, back to a day. */
function dayFromLong(text: string): string {
  const [date, month, year] = text.trim().split(/\s+/) as [string, string, string]
  return `${year}-${String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, '0')}-${date.padStart(2, '0')}`
}

export function balanceHistorySteps({ page, visit, exercised }: WebContext): Partial<Steps> {
  return {
    async readBalanceAcrossTheMonth(account) {
      await exercised('screen:/')
      await visit('/')
      // The home chart, read at its two ends the way a person reads it: by pointing at them.
      const wrap = page.getByRole('region', { name: 'Soldes' }).getByRole('img').first().locator('xpath=..')
      const box = await wrap.boundingBox()
      if (!box) throw new Error('the balance chart is not drawn')
      const at = async (x: number) => {
        await page.mouse.move(x, box.y + box.height / 2)
        const lines = (await wrap.locator('div.pointer-events-none').innerText()).split('\n').filter(Boolean)
        const line = lines.indexOf(account)
        if (line === -1) throw new Error(`no ${account} in the chart's tooltip: ${lines.join(' | ')}`)
        return { on: dayFromLong(lines[0] as string), balance: moneyOf(lines[line + 1] as string) }
      }
      return { first: await at(box.x + 2), last: await at(box.x + box.width - 2) }
    },
  }
}
