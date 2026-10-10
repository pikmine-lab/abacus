import { auth } from '@abacus/core/auth'
import { listAuthorizations } from '@abacus/core/authorizations'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AuthorizationRowActions } from '@/components/authorization-row-actions'
import { Block } from '@/components/composition'
import { McpConnection } from '@/components/mcp-connection'
import { EmptyLine, PageBody, PageHeader } from '@/components/page-shell'
import { getFormat } from '@/lib/format-server'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('shell.screens')
  return { title: t('connectAi') }
}

/**
 * The columns of the applications list, its header included, so the dates line
 * up under their names. Wide enough for the steps above to sit side by side,
 * the list takes their split, its dates under the second step, so the page has
 * one right column. Too narrow for the dates beside the name, they pass under
 * it and say which is which in words; those words are what assistive
 * technology reads at every width, the bare cells being for the eye.
 */
const COLUMNS =
  'grid w-full grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-x-4 gap-y-1 @xl:grid-cols-[minmax(0,1fr)_8rem_8rem_1.75rem] @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @3xl:gap-x-12'
/** The dates and the menu: cells of the row until the split, one column of it after. */
const TRAIL =
  'contents @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] @3xl:items-center @3xl:gap-x-4'
const DATE_CELL = 'hidden text-[12px] text-muted-foreground tabular @xl:block'

export default async function ConnectAiPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const authorizations = await listAuthorizations(session.user.id, await headers())
  const t = await getTranslations('settings.connectAi')
  const screens = await getTranslations('shell.screens')
  const format = await getFormat()
  // An instant, read as the calendar day it falls on in UTC.
  const day = (d: Date) =>
    format.dateAs(new Date(d).toISOString().slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <>
      <PageHeader title={screens('connectAi')} />

      <PageBody className="@container gap-10">
        <McpConnection mcpUrl={process.env.MCP_URL} />

        {authorizations.length === 0 ? (
          <Block label={t('applications')} rule>
            <EmptyLine>{t('noApplication')}</EmptyLine>
          </Block>
        ) : (
          <section aria-label={t('applications')} className="flex min-w-0 flex-col">
            <div className={cn(COLUMNS, 'border-b border-border pb-2')}>
              <h2 className="text-[13px] font-medium text-muted-foreground">{t('applications')}</h2>
              <div className={TRAIL}>
                <span aria-hidden className="hidden text-[11.5px] text-faint @xl:block">
                  {t('granted')}
                </span>
                <span aria-hidden className="hidden text-[11.5px] text-faint @xl:block">
                  {t('lastUsed')}
                </span>
              </div>
            </div>
            <div className="flex flex-col divide-y divide-border/70 border-b border-border">
              {authorizations.map((a) => (
                <div key={a.consentId} className={cn(COLUMNS, 'py-2.5')}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[13.5px] font-medium">{a.name}</span>
                      {a.domain && <span className="font-mono text-[11.5px] text-faint">{a.domain}</span>}
                    </div>
                    <p className="text-[11.5px] text-faint @xl:sr-only">
                      {a.lastUsedAt
                        ? t('datesUsed', { granted: day(a.grantedAt), used: day(a.lastUsedAt) })
                        : t('dates', { granted: day(a.grantedAt) })}
                    </p>
                  </div>
                  <div className={TRAIL}>
                    <span aria-hidden className={DATE_CELL}>
                      {day(a.grantedAt)}
                    </span>
                    <span aria-hidden className={cn(DATE_CELL, !a.lastUsedAt && 'text-faint')}>
                      {a.lastUsedAt ? day(a.lastUsedAt) : '—'}
                    </span>
                    <AuthorizationRowActions consentId={a.consentId} name={a.name} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </PageBody>
    </>
  )
}
