'use client'

import type { Activity, ActivityKind, DeductibleExpenses, RevenueBasis } from '@abacus/core/domain'
import { ArchiveIcon, ArchiveRestoreIcon, ListChecksIcon, PencilIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { CurrencySelect } from '@/components/currency-select'
import { EntrySheet } from '@/components/entry-sheet'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  closeActivityAction,
  createActivityAction,
  editActivityAction,
  reopenActivityAction,
  setActivityExceptionsAction,
} from '@/lib/actions'
import { cn, frDate } from '@/lib/utils'

interface Option {
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
function AccountList({ accounts, checked = [] }: { accounts: Option[]; checked?: string[] }) {
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
  categories,
  accounts,
  attached,
  onSuccess,
}: {
  /** Present when correcting an existing activity instead of declaring one. */
  activity?: Activity
  categories: Option[]
  /** The user's open accounts: what the activity may declare it lives on. */
  accounts: Option[]
  /** Those it already lives on. */
  attached?: string[]
  onSuccess?: () => void
}) {
  const editing = activity !== undefined
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? 'personal')
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
          setKind('personal')
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
      <TextField name="name" label="Nom" defaultValue={activity?.name ?? ''} placeholder="Freelance" />

      {kind === 'business' && (
        <>
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

export function NewActivitySheet({ categories, accounts }: { categories: Option[]; accounts: Option[] }) {
  return (
    <EntrySheet
      label="Activité"
      title="Nouvelle activité"
      variant="outline"
      description="Une sphère économique : indépendante avec son régime, ou personnelle pour l’analyse seule."
    >
      <ActivityForm categories={categories} accounts={accounts} />
    </EntrySheet>
  )
}

/**
 * One activity, read before it is acted on: its kind as a badge, its regime
 * and its dates on the line under the name. The gestures live in the menu.
 */
function ActivityRow({
  activity,
  categories,
  accounts,
  attached,
  exceptions,
  today,
}: {
  activity: Activity
  categories: Option[]
  /** The user's open accounts, and those this activity lives on. */
  accounts: Option[]
  attached: string[]
  /** The categories that go against its deductibility policy. */
  exceptions: string[]
  today: string
}) {
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [excepting, setExcepting] = useState(false)
  const [reopenState, reopen, reopenPending] = useActionState(reopenActivityAction, {})
  useEffect(() => {
    if (reopenState.ok) setReopening(false)
  }, [reopenState.ok])

  const closed = activity.closedOn !== null
  const business = activity.kind === 'business'
  const detail = [
    activity.regimeLabel,
    activity.startedOn && `depuis le ${frDate(activity.startedOn)}`,
    activity.closedOn && `close le ${frDate(activity.closedOn)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className={cn('flex items-center gap-3 py-2', closed && 'text-faint')}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12.5px]">{activity.name}</span>
            <Badge variant="outline" className="px-1.5 text-[10.5px] font-normal text-muted-foreground">
              {KIND_LABEL[activity.kind]}
            </Badge>
          </div>
          {detail && <span className="truncate text-[11px] text-faint">{detail}</span>}
        </div>
        <RowMenu label={activity.name}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            Modifier
          </DropdownMenuItem>
          {business && (
            <DropdownMenuItem onSelect={() => setExcepting(true)}>
              <ListChecksIcon />
              Exceptions de catégories
            </DropdownMenuItem>
          )}
          {closed ? (
            <DropdownMenuItem onSelect={() => setReopening(true)}>
              <ArchiveRestoreIcon />
              Réouvrir
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => setClosing(true)}>
              <ArchiveIcon />
              Clore
            </DropdownMenuItem>
          )}
        </RowMenu>
      </div>

      {/* Corrected in the same panel it was declared in, as everything else is. */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">{activity.name}</SheetTitle>
            <SheetDescription className="text-[12px]">
              Ce qui est déjà classé sous cette activité y reste. Le type et le fait générateur ne changent
              plus dès qu’une règle ou une facture existe.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <ActivityForm
              activity={activity}
              categories={categories}
              accounts={accounts}
              attached={attached}
              onSuccess={() => setEditing(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={excepting} onOpenChange={setExcepting}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Exceptions de {activity.name}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {activity.deductibleExpenses === 'all'
                ? 'Toute charge de l’activité est déductible, sauf celles cochées ici.'
                : 'Aucune charge de l’activité n’est déductible, sauf celles cochées ici.'}
            </DialogDescription>
          </DialogHeader>
          {categories.length === 0 ? (
            <p className="text-[12px] text-faint">Aucune catégorie à excepter.</p>
          ) : (
            <ActionForm
              action={setActivityExceptionsAction}
              onSuccess={() => setExcepting(false)}
              successLabel="Exceptions enregistrées"
            >
              <input type="hidden" name="activityId" value={activity.id} />
              <ExceptionList
                categories={categories}
                policy={activity.deductibleExpenses}
                checked={exceptions}
              />
              <SubmitButton className="self-start">Enregistrer</SubmitButton>
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>

      {/* The last day matters here: a regime ends on a date, not on the day
          the panel happens to be opened. */}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Clore « {activity.name} »</DialogTitle>
            <DialogDescription className="text-[12px]">
              Aucun mouvement ne s’y déclare après ce jour. L’historique reste entier, et un nouveau régime
              est une nouvelle activité.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={closeActivityAction} onSuccess={() => setClosing(false)}>
            <input type="hidden" name="activityId" value={activity.id} />
            <Field label="Dernier jour" name="closedOn">
              <DateField name="closedOn" defaultValue={today} />
            </Field>
            <SubmitButton variant="destructive" className="self-start">
              Clore
            </SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={reopening} onOpenChange={setReopening}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réouvrir « {activity.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              L’activité accepte de nouveau des mouvements. Son historique ne change pas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reopenState.error && <p className="text-xs text-destructive">{reopenState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={reopen}>
              <input type="hidden" name="activityId" value={activity.id} />
              <Button type="submit" disabled={reopenPending}>
                {reopenPending ? '…' : 'Réouvrir'}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ActivityRows({
  activities,
  categories,
  accounts,
  links,
  exceptions,
  today,
}: {
  activities: Activity[]
  categories: Option[]
  /** The user's open accounts, offered to every row. */
  accounts: Option[]
  /** Every account link of the user, keyed on the fly by activity. */
  links: { activityId: string; accountId: string }[]
  /** Every exception of the user, keyed on the fly by activity. */
  exceptions: { activityId: string; categoryId: string }[]
  today: string
}) {
  return (
    <Rows>
      {activities.map((activity) => (
        <ActivityRow
          key={activity.id}
          activity={activity}
          categories={categories}
          accounts={accounts}
          attached={links.filter((l) => l.activityId === activity.id).map((l) => l.accountId)}
          exceptions={exceptions.filter((e) => e.activityId === activity.id).map((e) => e.categoryId)}
          today={today}
        />
      ))}
    </Rows>
  )
}
