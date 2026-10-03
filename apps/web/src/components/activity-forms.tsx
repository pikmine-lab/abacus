'use client'

import type { Activity, ActivityKind, DeductibleExpenses, RevenueBasis } from '@abacus/core/domain'
import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react'
import { useActionState, useState } from 'react'
import { CurrencySelect } from '@/components/currency-select'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import {
  EntryRow,
  Fiche,
  FicheSection,
  ListEmpty,
  ListPane,
  type Selection,
  selectionOf,
} from '@/components/master-detail'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  closeActivityAction,
  createActivityAction,
  editActivityAction,
  reopenActivityAction,
  setActivityExceptionsAction,
} from '@/lib/actions'
import { entryHref } from '@/lib/entry-href'
import { frDate } from '@/lib/utils'

export interface Option {
  id: string
  name: string
}

const KIND_LABEL: Record<ActivityKind, string> = { business: 'Indépendante', personal: 'Personnelle' }

/** Rendered once, from the locale, like the calendar's own month names. */
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(2000, i, 1).toLocaleDateString('fr-FR', { month: 'long' }),
}))

/**
 * An exclusive choice that has to reach the server: the tabs show it, a hidden
 * field carries it. Not wrapped in a Field, whose label element would forward a
 * click on the caption to the first tab.
 */
function Choice({
  label,
  name,
  value,
  onValueChange,
  options,
}: {
  label: string
  name: string
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="hidden" name={name} value={value} />
      <Tabs value={value} onValueChange={onValueChange}>
        <TabsList className="w-full">
          {options.map((o) => (
            <TabsTrigger key={o.value} value={o.value}>
              {o.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

/**
 * The categories that go against the deductibility policy. The caption says
 * what a tick means under the policy in force, because the same list reads
 * the opposite way under the other one.
 */
function ExceptionList({
  categories,
  policy,
  checked = [],
}: {
  categories: Option[]
  policy: DeductibleExpenses
  checked?: string[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        {policy === 'all' ? 'Sauf ces catégories' : 'Déductibles quand même'}
      </span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {categories.map((c) => (
          <Label key={c.id} className="flex items-center gap-2 text-[12px] font-normal">
            <Checkbox name="exceptionCategoryIds" value={c.id} defaultChecked={checked.includes(c.id)} />
            <span className="truncate">{c.name}</span>
          </Label>
        ))}
      </div>
    </div>
  )
}

/**
 * The accounts the activity lives on. A checklist and not a choice: an account
 * exists before the activities that use it, and several may run on the same
 * one, which is the only thing the caption has to teach.
 */
export function AccountList({ accounts, checked = [] }: { accounts: Option[]; checked?: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Comptes · un compte peut en servir plusieurs</span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {accounts.map((a) => (
          <Label key={a.id} className="flex items-center gap-2 text-[12px] font-normal">
            <Checkbox name="accountIds" value={a.id} defaultChecked={checked.includes(a.id)} />
            <span className="truncate">{a.name}</span>
          </Label>
        ))}
      </div>
    </div>
  )
}

/**
 * Declaring and correcting share this panel. A personal activity is a name
 * and nothing else, so the regime block only opens on a business one; the
 * exceptions by category are asked at creation, when the policy is being
 * stated, and corrected afterwards through their own gesture in the row menu.
 */
export function ActivityForm({
  activity,
  draft,
  categories,
  accounts,
  attached,
  onSuccess,
}: {
  /** Present when correcting an existing activity instead of declaring one. */
  activity?: Activity
  /** What the guided creation already knows, when it steps aside for this form. */
  draft?: { name?: string; kind?: ActivityKind; jurisdiction?: string }
  categories: Option[]
  /** The user's open accounts: what the activity may declare it lives on. */
  accounts: Option[]
  /** Those it already lives on. */
  attached?: string[]
  onSuccess?: () => void
}) {
  const editing = activity !== undefined
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? draft?.kind ?? 'personal')
  const [basis, setBasis] = useState<RevenueBasis>(activity?.revenueBasis ?? 'cash')
  const [deductible, setDeductible] = useState<DeductibleExpenses>(activity?.deductibleExpenses ?? 'none')
  const [vat, setVat] = useState(activity?.vatRegistered ?? false)

  return (
    <ActionForm
      action={editing ? editActivityAction : createActivityAction}
      successLabel={editing ? 'Activité corrigée' : 'Activité créée'}
      onSuccess={() => {
        // A success remounts the fields; this state lives above the remount.
        if (!editing) {
          setKind(draft?.kind ?? 'personal')
          setBasis('cash')
          setDeductible('none')
          setVat(false)
        }
        onSuccess?.()
      }}
    >
      {editing && <input type="hidden" name="activityId" value={activity.id} />}
      <Choice
        label="Type"
        name="kind"
        value={kind}
        onValueChange={(v) => setKind(v as ActivityKind)}
        options={[
          { value: 'business', label: KIND_LABEL.business },
          { value: 'personal', label: KIND_LABEL.personal },
        ]}
      />
      <TextField
        name="name"
        label="Nom"
        defaultValue={activity?.name ?? draft?.name ?? ''}
        placeholder="Freelance"
      />

      {kind === 'business' && (
        <>
          <TextField
            name="jurisdiction"
            label="Juridiction"
            defaultValue={activity?.jurisdiction ?? draft?.jurisdiction ?? ''}
            placeholder="Où l’activité est exercée"
          />
          <TextField
            name="regimeLabel"
            label="Régime"
            defaultValue={activity?.regimeLabel ?? ''}
            placeholder="Le régime, en clair"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début" name="startedOn">
              <DateField name="startedOn" defaultValue={activity?.startedOn ?? undefined} />
            </Field>
            <Field label="Devise" name="currency">
              <CurrencySelect defaultValue={activity?.currency ?? 'EUR'} />
            </Field>
          </div>
          {accounts.length > 0 && <AccountList accounts={accounts} checked={attached} />}
          <Choice
            label="Fait générateur"
            name="revenueBasis"
            value={basis}
            onValueChange={(v) => setBasis(v as RevenueBasis)}
            options={[
              { value: 'cash', label: 'Encaissement' },
              { value: 'invoiced', label: 'Facturation' },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Exercice · mois" name="fiscalYearStartMonth">
              <FormSelect
                name="fiscalYearStartMonth"
                defaultValue={String(activity?.fiscalYearStartMonth ?? 1)}
                options={MONTHS}
              />
            </Field>
            <TextField
              name="fiscalYearStartDay"
              label="Exercice · jour"
              inputMode="numeric"
              defaultValue={String(activity?.fiscalYearStartDay ?? 1)}
            />
          </div>
          <Label className="flex items-center gap-2 text-[11.5px] font-normal text-muted-foreground">
            <Checkbox name="vatRegistered" checked={vat} onCheckedChange={(c) => setVat(c === true)} />
            assujettie à la TVA
          </Label>
          {vat && (
            <TextField
              name="defaultVatRate"
              label="TVA par défaut (%)"
              inputMode="decimal"
              defaultValue={activity?.defaultVatRate ?? ''}
              placeholder="20"
            />
          )}
          <Choice
            label="Charges"
            name="deductibleExpenses"
            value={deductible}
            onValueChange={(v) => setDeductible(v as DeductibleExpenses)}
            options={[
              { value: 'all', label: 'Toutes déductibles' },
              { value: 'none', label: 'Aucune' },
            ]}
          />
          {!editing && categories.length > 0 && <ExceptionList categories={categories} policy={deductible} />}
        </>
      )}

      <SubmitButton className="self-start">{editing ? 'Enregistrer' : 'Créer l’activité'}</SubmitButton>
    </ActionForm>
  )
}

/**
 * The activities, read before they are acted on: the regime and the dates
 * under the name, the kind at the end. A closed one stays in the list, faint:
 * it is still corrected and reopened from its sheet.
 */
export function ActivityList({
  activities,
  listHref,
  selection,
  tools,
}: {
  activities: Activity[]
  listHref: string
  selection: Selection
  tools?: React.ReactNode
}) {
  return (
    <ListPane tools={tools}>
      {activities.length === 0 ? (
        <ListEmpty>Aucune activité. Tout est considéré comme perso.</ListEmpty>
      ) : (
        activities.map((activity) => (
          <EntryRow
            key={activity.id}
            href={entryHref(listHref, activity.id)}
            selected={selectionOf(selection, activity.id)}
            muted={activity.closedOn !== null}
            title={activity.name}
            detail={
              [
                activity.jurisdiction,
                activity.regimeLabel,
                activity.startedOn && `depuis le ${frDate(activity.startedOn)}`,
                activity.closedOn && `close le ${frDate(activity.closedOn)}`,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            // Only the exception trails: the regime under the name already says
            // an activity is a business one, and the room goes to it.
            trailing={activity.kind === 'personal' ? KIND_LABEL.personal : undefined}
          />
        ))
      )}
    </ListPane>
  )
}

/**
 * One activity's sheet: what it is, corrected in the form it was declared
 * with, then the exceptions to its deductibility policy, then closing it or
 * reopening it. A business activity leads to the page of its regime.
 */
export function ActivityFiche({
  activity,
  categories,
  accounts,
  attached,
  exceptions,
  today,
  back,
}: {
  activity: Activity
  categories: Option[]
  /** The user's open accounts, and those this activity lives on. */
  accounts: Option[]
  attached: string[]
  /** The categories that go against its deductibility policy. */
  exceptions: string[]
  today: string
  back: { href: string; label: string }
}) {
  const [reopenState, reopen, reopenPending] = useActionState(reopenActivityAction, {})
  const closed = activity.closedOn !== null
  const business = activity.kind === 'business'

  return (
    <Fiche
      title={activity.name}
      badge={
        <Badge variant="outline" className="px-1.5 text-[11px] font-normal text-muted-foreground">
          {KIND_LABEL[activity.kind]}
        </Badge>
      }
      link={
        business ? { href: `/settings/activities/${activity.id}?from=settings`, label: 'Régime' } : undefined
      }
      back={back}
    >
      <p className="mb-4 text-[12px] text-faint">
        Ce qui est déjà classé sous cette activité y reste. Le type et le fait générateur ne changent plus dès
        qu’une règle ou une facture existe.
      </p>
      <ActivityForm activity={activity} categories={categories} accounts={accounts} attached={attached} />

      {business && (
        <FicheSection label="Exceptions de catégories">
          {categories.length === 0 ? (
            <p className="text-[12px] text-faint">Aucune catégorie à excepter.</p>
          ) : (
            <ActionForm action={setActivityExceptionsAction} successLabel="Exceptions enregistrées">
              <input type="hidden" name="activityId" value={activity.id} />
              <p className="text-[12px] text-faint">
                {activity.deductibleExpenses === 'all'
                  ? 'Toute charge de l’activité est déductible, sauf celles cochées ici.'
                  : 'Aucune charge de l’activité n’est déductible, sauf celles cochées ici.'}
              </p>
              <ExceptionList
                categories={categories}
                policy={activity.deductibleExpenses}
                checked={exceptions}
              />
              <SubmitButton variant="outline" className="self-start">
                Enregistrer
              </SubmitButton>
            </ActionForm>
          )}
        </FicheSection>
      )}

      {closed ? (
        <FicheSection label="Réouvrir">
          <p className="text-[12px] text-faint">
            L’activité accepte de nouveau des mouvements. Son historique ne change pas.
          </p>
          <form action={reopen} className="flex flex-col gap-2">
            <input type="hidden" name="activityId" value={activity.id} />
            <Button type="submit" variant="outline" disabled={reopenPending} className="self-start">
              <ArchiveRestoreIcon />
              {reopenPending ? '…' : 'Réouvrir'}
            </Button>
            {reopenState.error && <p className="text-xs text-destructive">{reopenState.error}</p>}
          </form>
        </FicheSection>
      ) : (
        // The last day matters here: a regime ends on a date, not on the day
        // the sheet happens to be opened.
        <FicheSection label="Clore">
          <p className="text-[12px] text-faint">
            Aucun mouvement ne s’y déclare après ce jour. L’historique reste entier, et un nouveau régime est
            une nouvelle activité.
          </p>
          <ActionForm action={closeActivityAction} className="flex-row flex-wrap items-end gap-2">
            <input type="hidden" name="activityId" value={activity.id} />
            <Field label="Dernier jour" name="closedOn" className="w-44">
              <DateField name="closedOn" defaultValue={today} />
            </Field>
            <SubmitButton variant="destructive">
              <ArchiveIcon />
              Clore
            </SubmitButton>
          </ActionForm>
        </FicheSection>
      )}
    </Fiche>
  )
}
