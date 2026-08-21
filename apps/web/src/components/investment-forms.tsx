'use client'

import { CheckIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  correctOperationAction,
  declareAssetAction,
  deleteOperationAction,
  recordOperationAction,
  renameAssetAction,
} from '@/lib/actions'

interface Option {
  id: string
  name: string
}

export interface AssetEntry {
  id: string
  name: string
  /** Where its price comes from. Absent: priced by hand. */
  pricing: string | null
  /** The only unambiguous identifier of a fund, when it is known. */
  isin: string | null
  followed: boolean
}

export interface InstrumentHit {
  source: 'yahoo' | 'coingecko'
  reference: string
  name: string
  issuer: string | null
  payout: 'accumulating' | 'distributing' | null
  kind: 'security' | 'crypto'
  typeLabel: string
  venue: string | null
  isin: string | null
  price: string | null
  currency: string | null
  available: boolean
  otherVenues: number
}

const TYPES = [
  { value: 'buy', label: 'Achat' },
  { value: 'sell', label: 'Vente' },
  { value: 'dividend', label: 'Dividende' },
  { value: 'fee', label: 'Frais' },
] as const

type OperationType = (typeof TYPES)[number]['value']

const PAYOUT = { accumulating: 'capitalisant', distributing: 'distribuant' } as const

function amount(value: string, currency: string | null): string {
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency ?? ''}`.trim()
}

/** A default worth keeping: the fund's own name minus what every fund repeats. */
function shortName(name: string): string {
  return name
    .replace(/\s+(UCITS\s+)?ETF\b.*$/i, '')
    .replace(/\s+-\s+.*$/, '')
    .trim()
    .slice(0, 40)
}

/**
 * Finding what one holds, by whatever they know it as: a name ("s&p 500"), a
 * provider ("amundi"), a ticker, an ISIN, a coin. Nobody knows a Yahoo ticker by
 * heart, so typing one was never the interface.
 *
 * One line is one fund, not one line of quotation, and it carries what actually
 * tells two trackers of the same index apart: who runs it, whether it pays out
 * or accumulates, and its price. The price is the point, because it is the one
 * number that can be compared against a broker's statement, and that comparison
 * is the only way to be certain this is the same holding. What no venue quotes
 * in euros stays visible and disabled, with its currency: vanishing would read
 * as "not found".
 */
function InstrumentSearch({
  known,
  onPickKnown,
  onPickNew,
}: {
  known: AssetEntry[]
  onPickKnown?: (asset: AssetEntry) => void
  onPickNew: (hit: InstrumentHit) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<InstrumentHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    // Typing is faster than two third-party APIs: wait for a pause, and let a
    // newer keystroke abort the request its predecessor started.
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        setHits(response.ok ? await response.json() : [])
      } catch {
        // Aborted or offline: leave the previous hits rather than blanking out.
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const term = query.trim().toLowerCase()
  const mine = onPickKnown
    ? known.filter((a) => term.length === 0 || a.name.toLowerCase().includes(term))
    : []
  const securities = hits.filter((h) => h.kind === 'security')
  const coins = hits.filter((h) => h.kind === 'crypto')

  const found = (label: string, items: InstrumentHit[]) =>
    items.length > 0 && (
      <CommandGroup heading={label}>
        {items.map((hit) => (
          <CommandItem
            key={`${hit.source}:${hit.reference}`}
            value={`new:${hit.reference}`}
            disabled={!hit.available}
            onSelect={() => hit.available && onPickNew(hit)}
            className="items-start gap-3"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">{hit.name}</span>
              <span className="truncate text-[11px] text-faint">
                {[
                  hit.issuer,
                  hit.payout ? PAYOUT[hit.payout] : null,
                  hit.venue ?? hit.typeLabel,
                  hit.otherVenues > 0 ? `+${hit.otherVenues} places` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className="tabular shrink-0 text-[11.5px] text-muted-foreground">
              {hit.price ? amount(hit.price, hit.currency) : (hit.currency ?? '')}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    )

  return (
    <Command shouldFilter={false} className="bg-transparent">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Nom, ISIN, symbole, fournisseur…"
        autoFocus
      />
      {/* Said once, where it is needed: the ISIN is in the broker's app and it
          is the only thing about a fund that cannot be mistaken. */}
      <p className="px-0.5 pt-1.5 text-[11px] text-faint">
        Le plus sûr : colle l’ISIN, affiché par ta banque. Sinon, le cours doit coller à ton relevé.
      </p>
      <CommandList className="mt-1.5">
        {query.trim().length >= 2 && <CommandEmpty>{searching ? 'Recherche…' : 'Rien trouvé.'}</CommandEmpty>}
        {mine.length > 0 && onPickKnown && (
          <CommandGroup heading="Déjà à toi">
            {mine.map((asset) => (
              <CommandItem
                key={asset.id}
                value={`known:${asset.id}`}
                onSelect={() => onPickKnown(asset)}
                className="items-start gap-3"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{asset.name}</span>
                  <span className="truncate text-[11px] text-faint">
                    {[asset.isin, asset.pricing ?? 'cours saisi à la main', asset.followed ? 'suivi' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {found('Titres et ETF', securities)}
        {found('Cryptos', coins)}
      </CommandList>
    </Command>
  )
}

/** What was picked, shown back, so a wrong pick is caught before sending. */
function Picked({ hit, onChange }: { hit: InstrumentHit; onChange: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-good" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px]">{hit.name}</span>
        <span className="text-[11px] text-faint">
          {[
            hit.isin,
            hit.issuer,
            hit.payout ? PAYOUT[hit.payout] : null,
            hit.venue,
            hit.price ? amount(hit.price, hit.currency) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 text-[11.5px] text-muted-foreground hover:text-primary"
      >
        Changer
      </button>
    </div>
  )
}

/** The hidden fields that carry a freshly picked instrument to the server. */
function PickedFields({ hit, name }: { hit: InstrumentHit; name: string }) {
  return (
    <>
      <input type="hidden" name="source" value={hit.source} />
      <input type="hidden" name="reference" value={hit.reference} />
      <input type="hidden" name="kind" value={hit.kind} />
      <input type="hidden" name="description" value={hit.name} />
      <input type="hidden" name="assetName" value={name} />
      {hit.isin && <input type="hidden" name="isin" value={hit.isin} />}
    </>
  )
}

/**
 * What happens inside an investment account. Looking the asset up lives here,
 * not in an errand beforehand: one searches for what one bought at the moment
 * one declares having bought it, and an unknown asset is created by the same
 * gesture.
 *
 * Funding the account is still not here, and the panel says so: that is a
 * transfer, declared with the movements.
 */
export function OperationForm({
  accounts,
  assets,
  today,
}: {
  accounts: Option[]
  assets: AssetEntry[]
  today: string
}) {
  const [type, setType] = useState<OperationType>('buy')
  const [known, setKnown] = useState<AssetEntry | null>(assets[0] ?? null)
  const [picked, setPicked] = useState<InstrumentHit | null>(null)
  const [name, setName] = useState('')
  const [choosing, setChoosing] = useState(assets.length === 0)
  const trade = type === 'buy' || type === 'sell'
  const needsAsset = type !== 'fee'

  return (
    <ActionForm action={recordOperationAction} successLabel="Opération déclarée">
      <input type="hidden" name="type" value={type} />
      <Tabs value={type} onValueChange={(v) => setType(v as OperationType)}>
        <TabsList className="w-full">
          {TYPES.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Field label="Compte">
        <FormSelect
          name="accountId"
          defaultValue={accounts[0]?.id}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Field>

      {needsAsset && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Actif</span>
          {choosing ? (
            <InstrumentSearch
              known={assets}
              onPickKnown={(asset) => {
                setKnown(asset)
                setPicked(null)
                setChoosing(false)
              }}
              onPickNew={(hit) => {
                setPicked(hit)
                setKnown(null)
                setName(shortName(hit.name))
                setChoosing(false)
              }}
            />
          ) : picked ? (
            <>
              <Picked hit={picked} onChange={() => setChoosing(true)} />
              <PickedFields hit={picked} name={name} />
              <Field label="Sous quel nom le suivre">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </>
          ) : (
            known && (
              <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
                <input type="hidden" name="assetId" value={known.id} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[12.5px]">{known.name}</span>
                  <span className="truncate text-[11px] text-faint">
                    {known.isin ?? known.pricing ?? 'cours saisi à la main'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setChoosing(true)}
                  className="shrink-0 text-[11.5px] text-muted-foreground hover:text-primary"
                >
                  Changer
                </button>
              </div>
            )
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" name="operatedOn">
          <DateField name="operatedOn" defaultValue={today} />
        </Field>
        {trade && (
          <Field label="Quantité" name="quantity">
            <Input name="quantity" inputMode="decimal" placeholder="12,5" autoComplete="off" />
          </Field>
        )}
      </div>

      <Field
        label={
          type === 'buy'
            ? 'Montant débité, frais d’ordre compris'
            : type === 'sell'
              ? 'Montant crédité'
              : type === 'dividend'
                ? 'Montant reçu'
                : 'Montant des frais'
        }
        name="amount"
      >
        <AmountInput name="amount" />
      </Field>

      <TextField name="note" label="Note (optionnel)" placeholder="" />
      <SubmitButton className="self-start" disabled={needsAsset && !known && !picked}>
        Déclarer
      </SubmitButton>
    </ActionForm>
  )
}

/**
 * Following something without holding it: the same search, and an asset with no
 * operation on it. Buying some later turns it into a position with nothing to
 * redeclare.
 */
export function FollowForm() {
  const [picked, setPicked] = useState<InstrumentHit | null>(null)
  const [byHand, setByHand] = useState(false)

  if (!picked && !byHand)
    return (
      <div className="flex flex-col gap-3">
        <InstrumentSearch known={[]} onPickNew={setPicked} />
        <button
          type="button"
          onClick={() => setByHand(true)}
          className="self-start text-[12px] text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
        >
          Aucune source ne le cote (SCPI, parts non cotées, bien)
        </button>
      </div>
    )

  return (
    <ActionForm action={declareAssetAction} successLabel="Actif suivi">
      {picked && (
        <>
          <Picked
            hit={picked}
            onChange={() => {
              setPicked(null)
              setByHand(false)
            }}
          />
          <input type="hidden" name="source" value={picked.source} />
          <input type="hidden" name="reference" value={picked.reference} />
          <input type="hidden" name="kind" value={picked.kind} />
          <input type="hidden" name="description" value={picked.name} />
          {picked.isin && <input type="hidden" name="isin" value={picked.isin} />}
        </>
      )}
      <TextField
        name="name"
        label="Sous quel nom"
        defaultValue={picked ? shortName(picked.name) : ''}
        placeholder="MSCI World"
      />
      <SubmitButton className="self-start">Suivre</SubmitButton>
    </ActionForm>
  )
}

/** The rename gesture, wherever an asset is listed: followed, or held. */
export function AssetMenu({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <RowMenu label={name}>
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          Renommer
        </DropdownMenuItem>
      </RowMenu>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{name}</DialogTitle>
          </DialogHeader>
          <ActionForm
            action={renameAssetAction}
            onSuccess={() => setEditing(false)}
            successLabel="Actif renommé"
          >
            <input type="hidden" name="assetId" value={id} />
            <TextField name="name" label="Nom" defaultValue={name} />
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AssetRow({ asset }: { asset: AssetEntry & { price: string | null } }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px]">{asset.name}</span>
        <span className="truncate text-[11px] text-faint">
          {[asset.isin, asset.pricing ?? 'cours saisi à la main'].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="tabular shrink-0 text-[12.5px] text-muted-foreground">
        {asset.price ? amount(asset.price, '€') : '—'}
      </span>
      <AssetMenu id={asset.id} name={asset.name} />
    </div>
  )
}

export function AssetRows({ assets }: { assets: (AssetEntry & { price: string | null })[] }) {
  return (
    <Rows>
      {assets.map((asset) => (
        <AssetRow key={asset.id} asset={asset} />
      ))}
    </Rows>
  )
}

export interface OperationEntry {
  id: string
  type: OperationType
  operatedOn: string
  quantity: string | null
  amount: string
  note: string | null
  accountId: string
  accountName: string
  assetName: string | null
}

const LABEL: Record<OperationType, string> = {
  buy: 'Achat',
  sell: 'Vente',
  dividend: 'Dividende',
  fee: 'Frais',
}

function frDay(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
}

/**
 * Declared operations, each correctable and deletable from its own menu. A
 * mistyped purchase amount is not cosmetic: it feeds the weighted average cost,
 * so it would misstate the holding for as long as it is held.
 */
function OperationRow({ operation, accounts }: { operation: OperationEntry; accounts: Option[] }) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const trade = operation.type === 'buy' || operation.type === 'sell'

  return (
    <>
      <div className="flex items-center gap-3 py-2">
        <span className="tabular w-20 shrink-0 text-[11.5px] text-faint">{frDay(operation.operatedOn)}</span>
        <span className="w-20 shrink-0 text-[12px] text-muted-foreground">{LABEL[operation.type]}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          {operation.assetName ?? 'frais de compte'}
          {operation.note && <span className="text-faint"> · {operation.note}</span>}
        </span>
        {operation.quantity && (
          <span className="tabular w-20 text-right text-[11.5px] text-faint">
            {Number(operation.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 8 })}
          </span>
        )}
        <span className="tabular w-24 text-right text-[12.5px]">{amount(operation.amount, '€')}</span>
        <RowMenu label={`${LABEL[operation.type]} du ${frDay(operation.operatedOn)}`}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            Corriger
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            Supprimer
          </DropdownMenuItem>
        </RowMenu>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              {LABEL[operation.type]} · {operation.assetName ?? 'frais de compte'}
            </DialogTitle>
          </DialogHeader>
          <ActionForm
            action={correctOperationAction}
            onSuccess={() => setEditing(false)}
            successLabel="Opération corrigée"
          >
            <input type="hidden" name="operationId" value={operation.id} />
            <input type="hidden" name="trade" value={String(trade)} />
            {/* The type and the asset stay out: changing either would make it
                another operation, which is a deletion and a new declaration. */}
            <Field label="Compte">
              <FormSelect
                name="accountId"
                defaultValue={operation.accountId}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" name="operatedOn">
                <DateField name="operatedOn" defaultValue={operation.operatedOn} />
              </Field>
              {trade && (
                <Field label="Quantité" name="quantity">
                  <Input
                    name="quantity"
                    inputMode="decimal"
                    defaultValue={operation.quantity ?? ''}
                    autoComplete="off"
                  />
                </Field>
              )}
            </div>
            <Field label="Montant" name="amount">
              <AmountInput name="amount" defaultValue={operation.amount} />
            </Field>
            <TextField name="note" label="Note (optionnel)" defaultValue={operation.note ?? ''} />
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">Supprimer cette opération ?</AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px]">
              {LABEL[operation.type]} du {frDay(operation.operatedOn)}, {amount(operation.amount, '€')} sur{' '}
              {operation.accountName}. La position et le PRU sont recalculés sans elle.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ActionForm action={deleteOperationAction} onSuccess={() => setDeleting(false)}>
            <input type="hidden" name="operationId" value={operation.id} />
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <SubmitButton variant="destructive">Supprimer</SubmitButton>
            </AlertDialogFooter>
          </ActionForm>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function OperationRows({
  operations,
  accounts,
}: {
  operations: OperationEntry[]
  accounts: Option[]
}) {
  return (
    <Rows>
      {operations.map((operation) => (
        <OperationRow key={operation.id} operation={operation} accounts={accounts} />
      ))}
    </Rows>
  )
}
