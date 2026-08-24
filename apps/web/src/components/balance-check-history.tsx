'use client'

import { PencilIcon, ScaleIcon, Trash2Icon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { correctBalanceCheckAction, deleteBalanceCheckAction, settleCheckGapAction } from '@/lib/actions'
import { eur, frDate } from '@/lib/utils'

export interface CheckEntry {
  id: string
  checkedOn: string
  declared: number
  computed: number
  gap: number
  /** Whether an adjustment movement settled the gap. */
  settled: boolean
}

/** What the settling form offers to attribute and file the adjustment. */
export interface SettleOptions {
  actors: { id: string; name: string }[]
  categories: { id: string; name: string }[]
}

/**
 * What was pointed on an account, and how to repair it. A check is a claim
 * about reality ("the balance was this, that day"), so it is mistypable like
 * any other declaration: the amount, and the day it was read.
 */
export function BalanceCheckHistory({ checks, options }: { checks: CheckEntry[]; options: SettleOptions }) {
  if (checks.length === 0) return <p className="text-[13px] text-faint">Ce compte n’a jamais été pointé.</p>

  return (
    <div className="flex flex-col divide-y divide-border/70 border-y border-border">
      {checks.map((check) => (
        <CheckRow key={check.id} check={check} options={options} />
      ))}
    </div>
  )
}

function CheckRow({ check, options }: { check: CheckEntry; options: SettleOptions }) {
  const [correcting, setCorrecting] = useState(false)
  const [settling, setSettling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteState, remove, deletePending] = useActionState(deleteBalanceCheckAction, {})

  useEffect(() => {
    if (deleteState.ok) setDeleting(false)
  }, [deleteState.ok])

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px]">{frDate(check.checkedOn)}</span>
        <span className={`text-[11px] ${check.gap === 0 ? 'text-faint' : 'text-destructive'}`}>
          {check.gap === 0 ? 'aucun écart' : `écart de ${eur(check.gap, 2)}`}
          {check.settled && ' · soldé par un ajustement'}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-[12.5px] tabular">{eur(check.declared, 2)}</span>
        <span className="font-mono text-[11px] text-faint tabular">calculé {eur(check.computed, 2)}</span>
      </div>
      <RowMenu label={`le pointage du ${frDate(check.checkedOn)}`}>
        <DropdownMenuItem onSelect={() => setCorrecting(true)}>
          <PencilIcon />
          Corriger
        </DropdownMenuItem>
        {check.gap !== 0 && !check.settled && (
          <DropdownMenuItem onSelect={() => setSettling(true)}>
            <ScaleIcon />
            Solder l’écart
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
          <Trash2Icon />
          Supprimer
        </DropdownMenuItem>
      </RowMenu>

      <Dialog open={correcting} onOpenChange={setCorrecting}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Pointage du {frDate(check.checkedOn)}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Corriger un pointage, c’est le refaire : l’écart est recalculé sur l’historique tel qu’il est
              aujourd’hui.
              {check.settled &&
                ' L’ajustement qui le soldait suit le nouvel écart, et disparaît s’il n’y a plus rien à solder.'}
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={correctBalanceCheckAction} onSuccess={() => setCorrecting(false)}>
            <input type="hidden" name="checkId" value={check.id} />
            <Field label="Solde réel (€)" name="balance">
              <AmountInput name="balance" defaultValue={check.declared.toFixed(2)} />
            </Field>
            <Field label="Lu le" name="checkedOn">
              <DateField name="checkedOn" defaultValue={check.checkedOn} />
            </Field>
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog open={settling} onOpenChange={setSettling}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Solder l’écart</DialogTitle>
            <DialogDescription className="text-[12px]">
              {eur(Math.abs(check.gap), 2)} {check.gap < 0 ? 'de sorties manquent' : 'd’entrées manquent'} au{' '}
              {frDate(check.checkedOn)}. Un seul mouvement daté de ce jour les porte, attribué à l’acteur
              choisi : dernier recours, déclarer ce qui manque vaut mieux.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={settleCheckGapAction}
            onSuccess={() => setSettling(false)}
            successLabel="Écart soldé"
          >
            <input type="hidden" name="checkId" value={check.id} />
            <datalist id={`settle-actors-${check.id}`}>
              {options.actors.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>
            <TextField
              name="actor"
              label="Attribué à"
              list={`settle-actors-${check.id}`}
              placeholder="Inconnu"
              autoComplete="off"
            />
            <Field label="Catégorie">
              <FormSelect
                name="categoryId"
                noneLabel="(aucune)"
                options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <TextField name="note" label="Note" defaultValue="Ajustement de pointage" />
            {/* The question the app cannot answer for the user: an écart that
                stands for forgotten entries belongs in the analysis, one that
                explains nothing does not. Unchecked by default, because the
                first case is the ordinary one. */}
            <Label className="flex items-start gap-2 text-[11.5px] font-normal text-muted-foreground">
              <Checkbox name="ghost" className="mt-px" />
              <span>
                fantôme : cet écart ne dit rien de mes flux (régularisation) et ne doit entrer dans aucune
                analyse
              </span>
            </Label>
            <SubmitButton className="self-start">Solder</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le pointage du {frDate(check.checkedOn)} ?</AlertDialogTitle>
            <AlertDialogDescription>
              {check.settled
                ? 'L’ajustement qui soldait son écart est supprimé avec lui : il n’existait que pour ce pointage.'
                : 'Les mouvements du compte ne sont pas touchés : un pointage ne fait que les confronter à la réalité.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteState.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={remove}>
              <input type="hidden" name="checkId" value={check.id} />
              <Button type="submit" variant="destructive" disabled={deletePending}>
                {deletePending ? '…' : 'Supprimer'}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
