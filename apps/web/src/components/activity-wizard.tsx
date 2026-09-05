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
import {
  LEVY_KIND_LABEL,
  LEVY_MEASURE_LABEL,
  LEVY_PERIOD_LABEL,
  LEVY_PERIOD_REF_LABEL,
  LEVY_STATUS_BADGE,
  thresholdValue,
} from '@/lib/levy-words'
import { type AnsweredQuestion, answered, answersOf } from '@/lib/regime-tree'
import { eur, frDate } from '@/lib/utils'

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

const BASIS_WORD: Record<string, string> = { cash: 'Encaissement', invoiced: 'Facturation' }

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
        setCreated('Activité créée')
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
      Je configure moi-même
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
        {back('Retour', () => setPhase('identity'))}
        {expert}
      </div>
    )

  if (phase === 'identity')
    return (
      <div className="flex flex-col gap-4">
        {created && <p className="text-xs text-good">✓ {created}</p>}
        {/* Controlled, unlike the fields of a form: this one is read by the
            steps that follow, and creating one activity has to clear it. */}
        <Field label="Nom" name="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Freelance" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Type</span>
          <Tabs value={kind} onValueChange={(v) => setKind(v as ActivityKind)}>
            <TabsList className="w-full">
              <TabsTrigger value="business">Indépendante</TabsTrigger>
              <TabsTrigger value="personal">Personnelle</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {kind === 'business' && (
          <div className="flex flex-col gap-1.5">
            <Field label="Juridiction" name="jurisdiction">
              <FormSelect
                name="jurisdiction"
                defaultValue={jurisdictionId}
                placeholder="Où tu exerces"
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
                  { value: ELSEWHERE, label: 'Ailleurs, je configure moi-même' },
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
              setCreated(`« ${name} » créée`)
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
            Continuer
          </Button>
        )}
      </div>
    )

  if (phase === 'tree') {
    const question = asking ?? step?.question ?? null
    const current = trail.find((s) => s.question.id === question?.id)?.value
    return (
      <div className="flex flex-col gap-4">
        {back(name || 'Retour', () => setPhase('identity'))}
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
          <p className="text-[12.5px] text-faint">
            Aucun régime du catalogue ne correspond à ces réponses. Reviens sur une réponse, ou configure
            l’activité toi-même.
          </p>
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
        {back('Revenir aux questions', backToQuestions)}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!preview ? (
          <p className="text-[12px] text-faint">…</p>
        ) : (
          <>
            <Review preview={preview} />
            <Button type="button" className="self-start" onClick={() => setPhase('finish')}>
              Continuer
            </Button>
            {selfExit}
          </>
        )}
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {back('Revenir à la relecture', () => setPhase('review'))}
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px]">{name}</span>
        <span className="text-[11px] text-faint">{preview?.model.name}</span>
      </div>
      <ActionForm
        action={createActivityFromRegimeAction}
        successLabel="Activité créée"
        onSuccess={() => {
          setCreated(`« ${name} » créée`)
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
        <Field label="Début" name="startedOn">
          <DateField name="startedOn" defaultValue={today} />
        </Field>
        {accounts.length > 0 && <AccountList accounts={accounts} />}
        <SubmitButton className="self-start">Créer l’activité</SubmitButton>
      </ActionForm>
    </div>
  )
}

/**
 * A personal activity creates itself as it always has: a name and its kind.
 * Everything the regime decides has no object here, so nothing else is asked.
 */
function PersonalCreate({ name, onSuccess }: { name: string; onSuccess: () => void }) {
  return (
    <ActionForm action={createActivityAction} onSuccess={onSuccess}>
      <input type="hidden" name="kind" value="personal" />
      <input type="hidden" name="name" value={name} />
      <SubmitButton className="self-start">Créer l’activité</SubmitButton>
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
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13.5px] font-medium">Quel régime ?</p>
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
function amountWords(levy: RegimeLevy): string {
  if (levy.amountForm === 'rate') return `${Number(levy.rate ?? 0).toLocaleString('fr-FR')} %`
  if (levy.amountForm === 'fixed')
    return typeof levy.fixedAmount === 'number' ? eur(levy.fixedAmount, 2) : 'montant saisi'
  if (levy.amountForm === 'brackets') {
    const rows = (levy.brackets as { rows?: unknown[] } | undefined)?.rows?.length ?? 0
    return `barème, ${rows} tranche${rows > 1 ? 's' : ''}`
  }
  if (levy.amountForm === 'elective_base') return 'base choisie'
  return 'rien à payer'
}

/**
 * What the rule is, read the way the rules screen reads it: its kind, how
 * often it falls, and what it is taken on. Its amount stands on its own
 * beside the name, where a figure that has to be checked belongs.
 */
function takesWords(levy: RegimeLevy): string {
  const words = [LEVY_KIND_LABEL[levy.kind] ?? levy.kind, LEVY_PERIOD_LABEL[levy.period] ?? levy.period]
  if (levy.baseMeasure && levy.baseMeasure !== 'none') {
    const measure = LEVY_MEASURE_LABEL[levy.baseMeasure] ?? levy.baseMeasure
    words.push(levy.basePeriodRef ? `${measure} sur ${LEVY_PERIOD_REF_LABEL[levy.basePeriodRef]}` : measure)
  }
  return words.join(' · ')
}

/**
 * The mention a status that is not `confirmed` earns: a figure still applied
 * past the text that fixed it, or one no text fixes at all, has to say so
 * where it is being accepted. Same badge as everywhere else it is read.
 */
function Status({ status }: { status?: string }) {
  const badge = status ? LEVY_STATUS_BADGE[status] : undefined
  if (!badge) return null
  return (
    <Badge variant={badge.variant} className="ml-1.5 text-[10px]">
      {badge.label}
    </Badge>
  )
}

/** Where a rule comes from, and the day it was read there. */
function Source({ sourceUrl, verifiedOn }: { sourceUrl?: string | null; verifiedOn?: string | null }) {
  return (
    <span className="text-[11px] text-faint">
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:text-primary hover:underline"
        >
          source
        </a>
      ) : (
        'sans source'
      )}
      {verifiedOn && ` · lue le ${frDate(verifiedOn)}`}
    </span>
  )
}

/**
 * A day of the year without its year, as French writes it: the first of a
 * month is "1er", every other day its plain number.
 */
function openingDay(month: number, day: number): string {
  const written = new Date(2000, month - 1, day).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  })
  return day === 1 ? written.replace(/^1\b/, '1er') : written
}

/** What is about to be written, before a single row of it exists. */
function Review({ preview }: { preview: RegimePreview }) {
  const { activity } = preview
  const exercise =
    activity.fiscalYearStartMonth && activity.fiscalYearStartDay
      ? openingDay(activity.fiscalYearStartMonth, activity.fiscalYearStartDay)
      : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <p className="text-[13.5px] font-medium">{preview.model.name}</p>
        <p className="text-[11.5px] leading-relaxed text-faint">{preview.model.description}</p>
      </div>

      <Block title="L’activité">
        <Rows>
          <Line label="Juridiction" value={preview.jurisdiction.name} />
          {activity.revenueBasis && (
            <Line
              label="Fait générateur"
              value={BASIS_WORD[activity.revenueBasis] ?? activity.revenueBasis}
            />
          )}
          <Line
            label="TVA"
            value={
              activity.vatRegistered
                ? typeof activity.defaultVatRate === 'number'
                  ? `Assujettie, ${Number(activity.defaultVatRate).toLocaleString('fr-FR')} % par défaut`
                  : 'Assujettie'
                : 'Non assujettie'
            }
          />
          {activity.deductibleExpenses && (
            <Line
              label="Charges"
              value={activity.deductibleExpenses === 'all' ? 'Toutes déductibles' : 'Aucune déductible'}
            />
          )}
          {exercise && <Line label="Exercice" value={`ouvre le ${exercise}`} />}
          {activity.currency && <Line label="Devise" value={activity.currency} />}
        </Rows>
      </Block>

      {preview.levies.length > 0 && (
        <Block title="Les règles" description="ce que l’activité devra, et sur quel texte">
          <Rows>
            {preview.levies.map((entry) => (
              <LevyLine key={entry.levy.name} entry={entry} />
            ))}
          </Rows>
        </Block>
      )}

      {preview.thresholds.length > 0 && (
        <Block title="Les seuils" description="ce qui change au-delà d’une valeur">
          <Rows>
            {preview.thresholds.map((threshold) => (
              <ThresholdLine key={threshold.label} threshold={threshold} />
            ))}
          </Rows>
        </Block>
      )}

      {preview.inputs.length > 0 && (
        <Block title="Les paramètres saisis" description="les chiffres qu’aucun calcul ne donne">
          <Rows>
            {preview.inputs.map((input) => (
              <div key={input.name} className="flex items-baseline gap-2 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-[12px]">{input.name}</span>
                  {input.note && <span className="text-[11px] leading-relaxed text-faint">{input.note}</span>}
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular">
                  {Number(input.value).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}
                </span>
              </div>
            ))}
          </Rows>
        </Block>
      )}

      <p className="text-[11.5px] leading-relaxed text-faint">
        Ces règles deviennent les tiennes : tu les corriges quand tu veux, et corriger le catalogue plus tard
        ne les touchera pas.
      </p>
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
  const { levy } = entry
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[12.5px]">
          {levy.name}
          <Status status={levy.status} />
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular text-muted-foreground">
          {amountWords(levy)}
        </span>
      </div>
      <span className="text-[11px] text-faint">{takesWords(levy)}</span>
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
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[12.5px]">
          {threshold.label}
          <Status status={threshold.status} />
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular">
          {thresholdValue(threshold.measure, threshold.value)}
        </span>
      </div>
      <span className="text-[11px] text-faint">
        {LEVY_MEASURE_LABEL[threshold.measure] ?? threshold.measure}
        {threshold.periodRef && ` sur ${LEVY_PERIOD_REF_LABEL[threshold.periodRef]}`}
        {threshold.comparison === 'gte' ? ' · au moins' : ' · au plus'}
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
  return (
    <EntrySheet
      label="Activité"
      title="Nouvelle activité"
      variant="outline"
      description="Une sphère économique : indépendante avec son régime, ou personnelle pour l’analyse seule."
    >
      <ActivityWizard
        jurisdictions={jurisdictions}
        categories={categories}
        accounts={accounts}
        today={today}
      />
    </EntrySheet>
  )
}
