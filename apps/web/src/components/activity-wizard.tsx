'use client'

import type { ActivityKind } from '@abacus/core/domain'
import type { RegimeQuestion } from '@abacus/core/domain/regime'
import type {
  JurisdictionSummary,
  PreviewLevy,
  PreviewThreshold,
  QuestionnaireStep,
  RegimeLevy,
  RegimePreview,
} from '@abacus/core/services/regimes'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { AccountList, ActivityForm, type Option } from '@/components/activity-forms'
import { EntrySheet } from '@/components/entry-sheet'
import { ActionForm, DateField, Field, FormSelect, SubmitButton } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createActivityAction,
  createActivityFromRegimeAction,
  regimePreviewAction,
  regimeStepAction,
} from '@/lib/actions'
import { type Format, useFormat } from '@/lib/format'
import { type LevyWords, useLevyWords } from '@/lib/levy-words'
import { type AnsweredQuestion, answered, answersOf } from '@/lib/regime-tree'

/**
 * Creating an activity by answering what one knows of oneself, rather than
 * what the engine needs to know (issue #90).
 *
 * Nothing here names a country, a regime, a rate or a rule: the jurisdictions,
 * the questions, their options and the rules they lead to are read from the
 * catalog and put on screen as they come. What the screen owns is the shape of
 * the walk: state what you are, answer the tree, read what will be written,
 * then the two fields the catalog cannot know (the day it started, the
 * accounts it lives on).
 *
 * Two ways out, on purpose. A personal activity is a name and nothing else, so
 * it never enters the tree. And "je configure moi-même" reaches the expert form
 * from the first step and from the review, because a place the catalog does
 * not cover, or a regime read differently, must not be a dead end.
 */

/** A value no jurisdiction id can take, since ids never open on an underscore. */
const ELSEWHERE = '__elsewhere__'

type Phase = 'identity' | 'tree' | 'review' | 'finish' | 'expert'

type WizardT = ReturnType<typeof useTranslations<'regime.wizard'>>
type AmountT = ReturnType<typeof useTranslations<'regime.amount'>>

export function ActivityWizard({
  jurisdictions,
  categories,
  accounts,
  today,
}: {
  jurisdictions: JurisdictionSummary[]
  categories: Option[]
  /** The user's open accounts: what the activity may declare it lives on. */
  accounts: Option[]
  today: string
}) {
  const t = useTranslations('regime.wizard')
  const ts = useTranslations('regime.shared')
  const [phase, setPhase] = useState<Phase>('identity')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ActivityKind>('business')
  const [jurisdictionId, setJurisdictionId] = useState('')
  const [trail, setTrail] = useState<AnsweredQuestion[]>([])
  /** A question being answered again, which suspends the walk on it. */
  const [asking, setAsking] = useState<RegimeQuestion | null>(null)
  const [step, setStep] = useState<QuestionnaireStep | null>(null)
  const [preview, setPreview] = useState<RegimePreview | null>(null)
  const [modelId, setModelId] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  /** What the last success is acknowledged with, until the next one starts. */
  const [created, setCreated] = useState<string | null>(null)

  const jurisdiction = jurisdictions.find((j) => j.id === jurisdictionId)

  /** Everything the tree produced, dropped: the next jurisdiction asks its own. */
  function resetTree(): void {
    setTrail([])
    setAsking(null)
    setStep(null)
    setPreview(null)
    setModelId('')
    setError(undefined)
  }

  // The walk is the service's, called again on every answer: the answers are
  // the whole state, so going back is dropping one and asking again.
  useEffect(() => {
    if (phase !== 'tree' || !jurisdiction) return
    let stale = false
    setStep(null)
    regimeStepAction(jurisdiction.id, answersOf(trail)).then((result) => {
      if (stale) return
      setError(result.error)
      setStep(result.step ?? null)
    })
    return () => {
      stale = true
    }
  }, [phase, jurisdiction, trail])

  // Nothing left to ask and one model standing: the questionnaire is over, so
  // the screen moves on rather than showing a step with no question in it.
  // Held while a question is being answered again, or coming back from the
  // review would bounce straight back to it.
  useEffect(() => {
    if (phase !== 'tree' || asking || !step?.done || step.models.length !== 1) return
    setModelId(step.models[0]!.id)
    setPhase('review')
  }, [phase, asking, step])

  useEffect(() => {
    if (phase !== 'review' || !modelId) return
    let stale = false
    setPreview(null)
    regimePreviewAction(modelId, answersOf(trail)).then((result) => {
      if (stale) return
      setError(result.error)
      setPreview(result.preview ?? null)
    })
    return () => {
      stale = true
    }
  }, [phase, modelId, trail])

  const reset = () => {
    setPhase('identity')
    setName('')
    setKind('business')
    setJurisdictionId('')
    setTrail([])
    setAsking(null)
    setStep(null)
    setPreview(null)
    setModelId('')
    setError(undefined)
  }

  const pick = (question: RegimeQuestion, value: string) => {
    setTrail(answered(trail, question, value))
    setAsking(null)
  }

  const expert = (
    <ActivityForm
      draft={{ name, kind: 'business', jurisdiction: jurisdiction?.name }}
      categories={categories}
      accounts={accounts}
      onSuccess={() => {
        // The expert form owns its own name field, which may no longer be the
        // one typed here: the acknowledgement says less rather than wrong.
        setCreated(t('created'))
        reset()
      }}
    />
  )

  const selfExit = (
    <button
      type="button"
      onClick={() => setPhase('expert')}
      className="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
    >
      {t('selfConfigure')}
    </button>
  )

  const back = (label: string, onClick: () => void) => (
    <Button type="button" variant="ghost" size="sm" className="self-start px-2" onClick={onClick}>
      <ChevronLeftIcon className="size-4" />
      {label}
    </Button>
  )

  /**
   * Back to the tree from the review: on the last question asked, not on a
   * walk that has nothing left to ask. Landing on a finished walk would take
   * the step below straight back to the review the person just left.
   */
  const backToQuestions = () => {
    setAsking(trail[trail.length - 1]?.question ?? null)
    setPhase('tree')
  }

  if (phase === 'expert')
    return (
      <div className="flex flex-col gap-4">
        {back(t('back'), () => setPhase('identity'))}
        {expert}
      </div>
    )

  if (phase === 'identity')
    return (
      <div className="flex flex-col gap-4">
        {created && <p className="text-xs text-good">✓ {created}</p>}
        {/* Controlled, unlike the fields of a form: this one is read by the
            steps that follow, and creating one activity has to clear it. */}
        <Field label={ts('name')} name="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t('type')}</span>
          <Tabs value={kind} onValueChange={(v) => setKind(v as ActivityKind)}>
            <TabsList className="w-full">
              <TabsTrigger value="business">{t('kinds.business')}</TabsTrigger>
              <TabsTrigger value="personal">{t('kinds.personal')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {kind === 'business' && (
          <div className="flex flex-col gap-1.5">
            <Field label={t('jurisdiction')} name="jurisdiction">
              <FormSelect
                name="jurisdiction"
                defaultValue={jurisdictionId}
                placeholder={t('jurisdictionPlaceholder')}
                onValueChange={(id) => {
                  // Answers belong to the jurisdiction that asked them. Keeping
                  // them across a change would carry an answer about one
                  // country's regime into another's tree, where it means
                  // nothing and yet still narrows.
                  if (id !== jurisdictionId) resetTree()
                  setJurisdictionId(id)
                }}
                options={[
                  ...jurisdictions.map((j) => ({ value: j.id, label: j.name })),
                  { value: ELSEWHERE, label: t('elsewhere') },
                ]}
              />
            </Field>
            {jurisdiction && <span className="text-[11px] text-faint">{jurisdiction.description}</span>}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {kind === 'personal' ? (
          <PersonalCreate
            name={name}
            onSuccess={() => {
              setCreated(t('createdNamed', { name }))
              reset()
            }}
          />
        ) : (
          <Button
            type="button"
            className="self-start"
            disabled={name.trim() === '' || jurisdictionId === ''}
            onClick={() => {
              setCreated(null)
              setPhase(jurisdictionId === ELSEWHERE ? 'expert' : 'tree')
            }}
          >
            {t('continue')}
          </Button>
        )}
      </div>
    )

  if (phase === 'tree') {
    const question = asking ?? step?.question ?? null
    const current = trail.find((s) => s.question.id === question?.id)?.value
    return (
      <div className="flex flex-col gap-4">
        {back(name || t('back'), () => setPhase('identity'))}
        {trail.length > 0 && (
          <Rows>
            {trail.map((given) => (
              <button
                key={given.question.id}
                type="button"
                onClick={() => setAsking(given.question)}
                className="group flex items-center gap-2 py-2 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[11px] text-faint">{given.question.label}</span>
                  <span className="truncate text-[12.5px]">
                    {given.question.options.find((o) => o.value === given.value)?.label ?? given.value}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-faint group-hover:text-primary" />
              </button>
            ))}
          </Rows>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {question ? (
          <Ask question={question} current={current} onPick={(value) => pick(question, value)} />
        ) : !step ? (
          <p className="text-[12px] text-faint">…</p>
        ) : step.models.length === 0 ? (
          <p className="text-[12.5px] text-faint">{t('noModel')}</p>
        ) : (
          <Choose
            models={step.models}
            onPick={(id) => {
              setModelId(id)
              setPhase('review')
            }}
          />
        )}

        {selfExit}
      </div>
    )
  }

  if (phase === 'review')
    return (
      <div className="flex flex-col gap-4">
        {back(t('backToQuestions'), backToQuestions)}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!preview ? (
          <p className="text-[12px] text-faint">…</p>
        ) : (
          <>
            <Review preview={preview} />
            <Button type="button" className="self-start" onClick={() => setPhase('finish')}>
              {t('continue')}
            </Button>
            {selfExit}
          </>
        )}
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {back(t('backToReview'), () => setPhase('review'))}
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px]">{name}</span>
        <span className="text-[11px] text-faint">{preview?.model.name}</span>
      </div>
      <ActionForm
        action={createActivityFromRegimeAction}
        successLabel={t('created')}
        onSuccess={() => {
          setCreated(t('createdNamed', { name }))
          reset()
        }}
      >
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="modelId" value={modelId} />
        {trail.map((given) => (
          <input
            key={given.question.id}
            type="hidden"
            name={`answer.${given.question.id}`}
            value={given.value}
          />
        ))}
        <Field label={t('startedOn')} name="startedOn">
          <DateField name="startedOn" defaultValue={today} />
        </Field>
        {accounts.length > 0 && <AccountList accounts={accounts} />}
        <SubmitButton className="self-start">{t('create')}</SubmitButton>
      </ActionForm>
    </div>
  )
}

/**
 * A personal activity creates itself as it always has: a name and its kind.
 * Everything the regime decides has no object here, so nothing else is asked.
 */
function PersonalCreate({ name, onSuccess }: { name: string; onSuccess: () => void }) {
  const t = useTranslations('regime.wizard')
  return (
    <ActionForm action={createActivityAction} onSuccess={onSuccess}>
      <input type="hidden" name="kind" value="personal" />
      <input type="hidden" name="name" value={name} />
      <SubmitButton className="self-start">{t('create')}</SubmitButton>
    </ActionForm>
  )
}

/** One question of the tree: its own words, and one row per option with its own. */
function Ask({
  question,
  current,
  onPick,
}: {
  question: RegimeQuestion
  /** The answer already given, when this question is being answered again. */
  current?: string
  onPick: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-[13.5px] font-medium">{question.label}</p>
        {question.help && <p className="text-[11.5px] text-faint">{question.help}</p>}
      </div>
      <Rows>
        {question.options.map((option) => (
          <Pick
            key={option.value}
            label={option.label}
            help={option.help}
            chosen={option.value === current}
            onPick={() => onPick(option.value)}
          />
        ))}
      </Rows>
    </div>
  )
}

/**
 * The last choice, when the answers leave several models standing: the tree
 * had nothing left that would tell them apart, so the person does.
 */
function Choose({
  models,
  onPick,
}: {
  models: { id: string; name: string; description: string }[]
  onPick: (id: string) => void
}) {
  const t = useTranslations('regime.wizard')
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13.5px] font-medium">{t('whichRegime')}</p>
      <Rows>
        {models.map((model) => (
          <Pick key={model.id} label={model.name} help={model.description} onPick={() => onPick(model.id)} />
        ))}
      </Rows>
    </div>
  )
}

/** One answer to choose: its words, its own explanation, and where it leads. */
function Pick({
  label,
  help,
  chosen,
  onPick,
}: {
  label: string
  help?: string
  chosen?: boolean
  onPick: () => void
}) {
  return (
    <button type="button" onClick={onPick} className="group flex items-start gap-2 py-2.5 text-left">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[12.5px] ${chosen ? 'text-primary' : ''}`}>{label}</span>
        {help && <span className="text-[11px] leading-relaxed text-faint">{help}</span>}
      </span>
      {chosen ? (
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      ) : (
        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-faint group-hover:text-primary" />
      )}
    </button>
  )
}

/** What the rule takes, in the shortest form that is still checkable. */
function amountWords(levy: RegimeLevy, t: AmountT, format: Format): string {
  if (levy.amountForm === 'rate') return t('rate', { rate: format.number(Number(levy.rate ?? 0), 3) })
  if (levy.amountForm === 'fixed')
    return typeof levy.fixedAmount === 'number' ? format.eur(levy.fixedAmount, 2) : t('statedAmount')
  if (levy.amountForm === 'brackets') {
    const rows = (levy.brackets as { rows?: unknown[] } | undefined)?.rows?.length ?? 0
    return t('brackets', { count: rows })
  }
  if (levy.amountForm === 'elective_base') return t('elective')
  return t('nothing')
}

/**
 * What the rule is, read the way the rules screen reads it: its kind, how
 * often it falls, and what it is taken on. Its amount stands on its own
 * beside the name, where a figure that has to be checked belongs.
 */
function takesWords(levy: RegimeLevy, words: LevyWords, over: OverT): string {
  const parts = [words.kind(levy.kind), words.period(String(levy.period))]
  if (levy.baseMeasure && levy.baseMeasure !== 'none') {
    const measure = words.measure(levy.baseMeasure)
    parts.push(
      levy.basePeriodRef
        ? over('measureOver', { measure, period: words.periodRef(levy.basePeriodRef) })
        : measure,
    )
  }
  return parts.join(' · ')
}

type OverT = ReturnType<typeof useTranslations<'regime.shared'>>

/**
 * The mention a status that is not `confirmed` earns: a figure still applied
 * past the text that fixed it, or one no text fixes at all, has to say so
 * where it is being accepted. Same badge as everywhere else it is read.
 */
function Status({ status }: { status?: string }) {
  const words = useLevyWords()
  const badge = status ? words.status(status) : undefined
  if (!badge) return null
  return (
    <Badge variant={badge.variant} className="ml-1.5 text-[10px]">
      {badge.label}
    </Badge>
  )
}

/** Where a rule comes from, and the day it was read there. */
function Source({ sourceUrl, verifiedOn }: { sourceUrl?: string | null; verifiedOn?: string | null }) {
  const t = useTranslations('regime.wizard')
  const format = useFormat()
  return (
    <span className="text-[11px] text-faint">
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:text-primary hover:underline"
        >
          {t('source')}
        </a>
      ) : (
        t('noSource')
      )}
      {verifiedOn && ` · ${t('readOn', { date: format.date(verifiedOn) })}`}
    </span>
  )
}

/**
 * The day a fiscal year opens, without its year. The catalog writes it the way
 * its language does (French says "1er" for the first of a month), so the
 * screen hands it the day as a number and the month as a name.
 */
function openingDay(month: number, day: number, t: WizardT, format: Format): string {
  const iso = `2000-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return t('review.opensOn', { day, month: format.dateAs(iso, { month: 'long' }) })
}

/** What is about to be written, before a single row of it exists. */
function Review({ preview }: { preview: RegimePreview }) {
  const t = useTranslations('regime.wizard')
  const format = useFormat()
  const { activity } = preview
  const opens =
    activity.fiscalYearStartMonth && activity.fiscalYearStartDay
      ? openingDay(activity.fiscalYearStartMonth, activity.fiscalYearStartDay, t, format)
      : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <p className="text-[13.5px] font-medium">{preview.model.name}</p>
        <p className="text-[11.5px] leading-relaxed text-faint">{preview.model.description}</p>
      </div>

      <Block title={t('review.activity')}>
        <Rows>
          <Line label={t('jurisdiction')} value={preview.jurisdiction.name} />
          {activity.revenueBasis && (
            <Line label={t('review.basis')} value={t(`review.bases.${activity.revenueBasis}`)} />
          )}
          <Line
            label={t('review.vat')}
            value={
              activity.vatRegistered
                ? typeof activity.defaultVatRate === 'number'
                  ? t('review.vatRegisteredRate', { rate: format.number(Number(activity.defaultVatRate), 3) })
                  : t('review.vatRegistered')
                : t('review.vatNotRegistered')
            }
          />
          {activity.deductibleExpenses && (
            <Line
              label={t('review.expenses')}
              value={
                activity.deductibleExpenses === 'all' ? t('review.allDeductible') : t('review.noneDeductible')
              }
            />
          )}
          {opens && <Line label={t('review.fiscalYear')} value={opens} />}
          {activity.currency && <Line label={t('review.currency')} value={activity.currency} />}
        </Rows>
      </Block>

      {preview.levies.length > 0 && (
        <Block title={t('review.rules')} description={t('review.rulesDescription')}>
          <Rows>
            {preview.levies.map((entry) => (
              <LevyLine key={entry.levy.name} entry={entry} />
            ))}
          </Rows>
        </Block>
      )}

      {preview.thresholds.length > 0 && (
        <Block title={t('review.thresholds')} description={t('review.thresholdsDescription')}>
          <Rows>
            {preview.thresholds.map((threshold) => (
              <ThresholdLine key={threshold.label} threshold={threshold} />
            ))}
          </Rows>
        </Block>
      )}

      {preview.inputs.length > 0 && (
        <Block title={t('review.inputs')} description={t('review.inputsDescription')}>
          <Rows>
            {preview.inputs.map((input) => (
              <div key={input.name} className="flex items-baseline gap-2 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-[12px]">{input.name}</span>
                  {input.note && <span className="text-[11px] leading-relaxed text-faint">{input.note}</span>}
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular">
                  {format.number(Number(input.value), 4)}
                </span>
              </div>
            ))}
          </Rows>
        </Block>
      )}

      <p className="text-[11.5px] leading-relaxed text-faint">{t('review.yours')}</p>
    </div>
  )
}

function Block({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[12.5px] font-semibold tracking-tight">{title}</h3>
        {description && <p className="min-w-0 truncate text-[11px] text-faint">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-2">
      <span className="shrink-0 text-[11.5px] text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right text-[12.5px]">{value}</span>
    </div>
  )
}

function LevyLine({ entry }: { entry: PreviewLevy }) {
  const ta = useTranslations('regime.amount')
  const ts = useTranslations('regime.shared')
  const words = useLevyWords()
  const format = useFormat()
  const { levy } = entry
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[12.5px]">
          {levy.name}
          <Status status={levy.status} />
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular text-muted-foreground">
          {amountWords(levy, ta, format)}
        </span>
      </div>
      <span className="text-[11px] text-faint">{takesWords(levy, words, ts)}</span>
      <Source sourceUrl={levy.sourceUrl} verifiedOn={levy.verifiedOn} />
      {entry.modifiers.map((modifier) => (
        <span key={modifier.label} className="pt-1 pl-3 text-[11px] leading-relaxed text-muted-foreground">
          {modifier.label}
          <Status status={modifier.status} />
        </span>
      ))}
    </div>
  )
}

function ThresholdLine({ threshold }: { threshold: PreviewThreshold }) {
  const t = useTranslations('regime.wizard')
  const ts = useTranslations('regime.shared')
  const words = useLevyWords()
  const measure = words.measure(threshold.measure)
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[12.5px]">
          {threshold.label}
          <Status status={threshold.status} />
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular">
          {words.thresholdValue(threshold.measure, threshold.value)}
        </span>
      </div>
      <span className="text-[11px] text-faint">
        {threshold.periodRef
          ? ts('measureOver', { measure, period: words.periodRef(threshold.periodRef) })
          : measure}
        {' · '}
        {threshold.comparison === 'gte' ? t('review.atLeast') : t('review.atMost')}
      </span>
      <span className="text-[11px] leading-relaxed text-faint">{threshold.consequence}</span>
      <Source sourceUrl={threshold.sourceUrl} verifiedOn={threshold.verifiedOn} />
    </div>
  )
}

export function NewActivitySheet({
  jurisdictions,
  categories,
  accounts,
  today,
}: {
  jurisdictions: JurisdictionSummary[]
  categories: Option[]
  accounts: Option[]
  today: string
}) {
  const t = useTranslations('regime.wizard.sheet')
  return (
    <EntrySheet label={t('label')} title={t('title')} description={t('description')}>
      <ActivityWizard
        jurisdictions={jurisdictions}
        categories={categories}
        accounts={accounts}
        today={today}
      />
    </EntrySheet>
  )
}
