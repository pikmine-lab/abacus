'use client'

import type { AssetNature } from '@abacus/core/domain'
import type { OperationSortField } from '@abacus/core/services/investments'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { MassFold } from '@/components/mass-fold'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { SortColumn } from '@/components/sort'
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
  stopFollowingAction,
} from '@/lib/actions'
import { DECLARED_NATURES, NATURE_LABEL, NATURE_ORDER } from '@/lib/nature'
import type { Sorter } from '@/lib/sort'

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
  /** The mass it belongs to, resolved by the service. */
  nature: AssetNature
}

export interface InstrumentVenue {
  reference: string
  venue: string | null
  price: string | null
  currency: string | null
  available: boolean
}

export interface InstrumentHit {
  source: 'yahoo' | 'coingecko'
  reference: string
  name: string
  issuer: string | null
  payout: 'accumulating' | 'distributing' | null
  kind: 'security' | 'equity' | 'fund' | 'crypto'
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

/** What the two typed numbers come to, shown so a wrong one is caught early. */
function product(quantity: string, unit: string): string | null {
  const read = (v: string) => Number(v.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'))
  const total = read(quantity) * read(unit)
  return Number.isFinite(total) && total > 0
    ? `${total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : null
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
 * is the only way to be certain this is the same holding. A foreign quote is
 * held like any other (its price converts to euros at read, issue #47); only a
 * line whose price could not be read stays visible and disabled, because
 * vanishing would read as "not found".
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
  // Venues are fetched when asked for, per fund: listing them for every result
  // would cost a search and a price per venue on every keystroke.
  const [expanded, setExpanded] = useState<string | null>(null)
  const [venues, setVenues] = useState<Record<string, InstrumentVenue[]>>({})

  async function toggleVenues(key: string, fund: string) {
    if (expanded === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    if (venues[key]) return
    try {
      const response = await fetch(`/api/instruments/venues?fund=${encodeURIComponent(fund)}`)
      const found: InstrumentVenue[] = response.ok ? await response.json() : []
      setVenues((prev) => ({ ...prev, [key]: found }))
    } catch {
      setVenues((prev) => ({ ...prev, [key]: [] }))
    }
  }

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
  // Everything Yahoo answers on one side, coins on the other: a share and a
  // fund are searched for in the same breath, and the mass they fall into is
  // read on the portfolio, not here.
  const securities = hits.filter((h) => h.kind !== 'crypto')
  const coins = hits.filter((h) => h.kind === 'crypto')

  const found = (label: string, items: InstrumentHit[]) =>
    items.length > 0 && (
      <CommandGroup heading={label}>
        {items.map((hit) => {
          const key = `${hit.source}:${hit.reference}`
          const open = expanded === key
          return (
            <div key={key} className={open ? 'rounded-sm bg-secondary/30' : undefined}>
              <CommandItem
                value={`new:${hit.reference}`}
                disabled={!hit.available}
                onSelect={() => hit.available && onPickNew(hit)}
                className="items-start gap-3"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{hit.name}</span>
                  <span className="truncate text-[11px] text-faint">
                    {/* The ticker and the ISIN first: they are what the broker's
                        app shows, so they are what makes a line recognisable. */}
                    {[hit.reference, hit.isin, hit.issuer, hit.payout ? PAYOUT[hit.payout] : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="tabular text-[11.5px] text-muted-foreground">
                    {hit.price ? amount(hit.price, hit.currency) : (hit.currency ?? '')}
                  </span>
                  <span className="text-[11px] text-faint">{hit.venue ?? hit.typeLabel}</span>
                </span>
              </CommandItem>
              {hit.otherVenues > 0 && (
                <button
                  type="button"
                  onClick={() => toggleVenues(key, hit.name)}
                  className="flex w-full items-center gap-1.5 px-2 pb-1.5 text-left text-[11px] text-muted-foreground hover:text-primary"
                >
                  {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
                  {/* Same fund, other venues: what changes between them is the
                      ticker, the place, the currency and the price, and nothing
                      else, which is why they sit under it and not beside it. */}
                  {open
                    ? 'même fonds, autres cotations'
                    : `${hit.otherVenues} autre${hit.otherVenues > 1 ? 's' : ''} cotation${
                        hit.otherVenues > 1 ? 's' : ''
                      } du même fonds`}
                </button>
              )}
              {open && (
                <div className="ml-2 border-l border-border pb-1 pl-2">
                  {venues[key] === undefined ? (
                    <p className="px-2 py-1 text-[11px] text-faint">Chargement…</p>
                  ) : venues[key]!.length === 0 ? (
                    <p className="px-2 py-1 text-[11px] text-faint">Aucune autre cotation trouvée.</p>
                  ) : (
                    venues[key]!.map((venue) => (
                      <CommandItem
                        key={venue.reference}
                        value={`venue:${venue.reference}`}
                        disabled={!venue.available}
                        onSelect={() =>
                          venue.available &&
                          onPickNew({
                            ...hit,
                            reference: venue.reference,
                            venue: venue.venue,
                            price: venue.price,
                            currency: venue.currency,
                            available: true,
                          })
                        }
                        className="gap-3"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px]">
                          {venue.reference}
                          <span className="text-faint"> · {venue.venue ?? '—'}</span>
                          {venue.reference === hit.reference && (
                            <span className="text-primary"> · retenue</span>
                          )}
                        </span>
                        <span className="tabular shrink-0 text-[11.5px] text-muted-foreground">
                          {venue.price ? amount(venue.price, venue.currency) : (venue.currency ?? '?')}
                        </span>
                      </CommandItem>
                    ))
                  )}
                  {venues[key]?.some((v) => !v.available) && (
                    // The greyed lines lack a price, not a currency: said once,
                    // under the ones concerned.
                    <p className="px-2 pt-1 text-[11px] text-faint">
                      Une cotation sans cours lisible n’est pas sélectionnable.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
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

/**
 * The mass a hand-priced asset belongs to, which is the only case where anyone
 * has to say: a quoted asset is typed by its source. A field like the panel's
 * others, one line tall, since it only ever appears for what no market quotes.
 */
function NatureField() {
  return (
    <Field label="Nature" name="nature">
      <FormSelect
        name="nature"
        placeholder="Choisir"
        options={DECLARED_NATURES.map((nature) => ({ value: nature, label: NATURE_LABEL[nature] }))}
      />
    </Field>
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
 * Choosing what an asset-shaped gesture is about: one already known, or one
 * looked up on the spot and created by the submit. Shared by the operation
 * panel and the scheduled placement, because both ask the same question and a
 * second copy of this would drift from the search it wraps.
 *
 * `onChosen` reports whether something is selected, so the form that owns the
 * submit button can refuse to send an asset-less declaration.
 */
export function AssetPicker({
  known: assets,
  onChosen,
}: {
  known: AssetEntry[]
  onChosen?: (chosen: boolean) => void
}) {
  const [known, setKnown] = useState<AssetEntry | null>(assets[0] ?? null)
  const [picked, setPicked] = useState<InstrumentHit | null>(null)
  const [name, setName] = useState('')
  const [choosing, setChoosing] = useState(assets.length === 0)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Actif</span>
      {choosing ? (
        <InstrumentSearch
          known={assets}
          onPickKnown={(asset) => {
            setKnown(asset)
            setPicked(null)
            setChoosing(false)
            onChosen?.(true)
          }}
          onPickNew={(hit) => {
            setPicked(hit)
            setKnown(null)
            setName(shortName(hit.name))
            setChoosing(false)
            onChosen?.(true)
          }}
        />
      ) : picked ? (
        <>
          <Picked
            hit={picked}
            onChange={() => {
              setChoosing(true)
              onChosen?.(false)
            }}
          />
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
              onClick={() => {
                setChoosing(true)
                onChosen?.(false)
              }}
              className="shrink-0 text-[11.5px] text-muted-foreground hover:text-primary"
            >
              Changer
            </button>
          </div>
        )
      )}
    </div>
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
  const [chosen, setChosen] = useState(assets.length > 0)
  // What the broker shows decides what gets typed: a total, or a price a share.
  const [basis, setBasis] = useState<'total' | 'unit'>('total')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
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

      {needsAsset && <AssetPicker known={assets} onChosen={setChosen} />}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" name="operatedOn">
          <DateField name="operatedOn" defaultValue={today} />
        </Field>
        {trade && (
          <Field label="Quantité" name="quantity">
            <Input
              name="quantity"
              inputMode="decimal"
              placeholder="12,5"
              autoComplete="off"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        )}
      </div>

      {trade ? (
        <div className="flex flex-col gap-2">
          {/* A broker shows a unit cost, not a total, and rebuilding the total
              from a valuation drags the venue's price difference into the cost
              basis. So it is said which one is being typed, and the other is
              computed rather than guessed. */}
          <Tabs value={basis} onValueChange={(v) => setBasis(v as typeof basis)}>
            <TabsList className="w-full">
              <TabsTrigger value="total">Montant total</TabsTrigger>
              <TabsTrigger value="unit">Prix unitaire</TabsTrigger>
            </TabsList>
          </Tabs>
          {basis === 'total' ? (
            <Field label={type === 'buy' ? 'Montant débité, frais compris' : 'Montant crédité'} name="amount">
              <AmountInput name="amount" />
            </Field>
          ) : (
            <Field label={type === 'buy' ? 'Prix payé par part' : 'Prix reçu par part'} name="unitPrice">
              <Input
                name="unitPrice"
                inputMode="decimal"
                placeholder="22,57"
                autoComplete="off"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Field>
          )}
          {basis === 'unit' && product(quantity, unit) && (
            <p className="text-[11.5px] text-faint">
              {quantity} × {unit} = <span className="tabular">{product(quantity, unit)}</span>
            </p>
          )}
        </div>
      ) : (
        <Field label={type === 'dividend' ? 'Montant reçu' : 'Montant des frais'} name="amount">
          <AmountInput name="amount" />
        </Field>
      )}

      <TextField name="note" label="Note (optionnel)" placeholder="" />
      <SubmitButton className="self-start" disabled={needsAsset && !chosen}>
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
      {/* Asked only for what no source quotes: a quoted asset is typed by its
          source, and re-typed at every price read. */}
      {!picked && <NatureField />}
      <SubmitButton className="self-start">Suivre</SubmitButton>
    </ActionForm>
  )
}

/**
 * What can be done to an asset from its row. Only a followed one can be
 * forgotten: an asset carrying operations is part of the account's history, so
 * the entry is not offered rather than offered and refused.
 */
export function AssetMenu({ id, name, followed = false }: { id: string; name: string; followed?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [dropping, setDropping] = useState(false)
  return (
    <>
      <RowMenu label={name}>
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          Renommer
        </DropdownMenuItem>
        {followed && (
          <DropdownMenuItem variant="destructive" onSelect={() => setDropping(true)}>
            <Trash2Icon />
            Arrêter de suivre
          </DropdownMenuItem>
        )}
      </RowMenu>
      <AlertDialog open={dropping} onOpenChange={setDropping}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">Arrêter de suivre {name} ?</AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px]">
              Rien n’a été déclaré dessus, donc il n’y a rien à perdre. Tu pourras le suivre à nouveau en le
              cherchant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ActionForm action={stopFollowingAction} onSuccess={() => setDropping(false)}>
            <input type="hidden" name="assetId" value={id} />
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <SubmitButton variant="destructive">Arrêter</SubmitButton>
            </AlertDialogFooter>
          </ActionForm>
        </AlertDialogContent>
      </AlertDialog>
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
      <AssetMenu id={asset.id} name={asset.name} followed={asset.followed} />
    </div>
  )
}

/**
 * Followed assets, grouped like the positions are: a watchlist mixes shares,
 * funds and coins exactly as much, and no total goes on a mass here since
 * nothing in it is held. One mass alone needs no header of its own.
 */
export function AssetRows({ assets }: { assets: (AssetEntry & { price: string | null })[] }) {
  const masses = NATURE_ORDER.map(
    (nature) => [nature, assets.filter((a) => a.nature === nature)] as const,
  ).filter(([, group]) => group.length > 0)
  return (
    <Rows>
      {masses.length === 1
        ? assets.map((asset) => <AssetRow key={asset.id} asset={asset} />)
        : masses.map(([nature, group]) => (
            <MassFold key={nature} nature={nature}>
              {group.map((asset) => (
                <AssetRow key={asset.id} asset={asset} />
              ))}
            </MassFold>
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
        {/* Always there, empty on a dividend or a fee: a column that comes and
            goes by row has no header to hang a sort on. */}
        <span className="tabular w-20 text-right text-[11.5px] text-faint">
          {operation.quantity
            ? Number(operation.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 8 })
            : ''}
        </span>
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

/** The criteria this list offers, named as its columns are. */
const OPERATION_COLUMNS: { field: OperationSortField; label: string; width: string }[] = [
  { field: 'date', label: 'Date', width: 'w-20' },
  { field: 'type', label: 'Type', width: 'w-20' },
  { field: 'asset', label: 'Actif', width: 'min-w-0 flex-1' },
  { field: 'quantity', label: 'Quantité', width: 'w-20' },
  { field: 'amount', label: 'Montant', width: 'w-24' },
]

export function OperationRows({
  operations,
  accounts,
  sorter,
}: {
  operations: OperationEntry[]
  accounts: Option[]
  sorter: Sorter<OperationSortField>
}) {
  return (
    <div className="overflow-x-auto">
      <Rows className="min-w-[34rem]">
        <div className="flex items-center gap-3 py-1.5 text-[11px] text-faint">
          {OPERATION_COLUMNS.map((column) => (
            <SortColumn
              key={column.field}
              sorter={sorter}
              field={column.field}
              label={column.label}
              align={column.field === 'quantity' || column.field === 'amount' ? 'right' : 'left'}
              className={`${column.width} shrink-0`}
            />
          ))}
          {/* The row menu's own width, so the header stops where the rows do. */}
          <span className="w-8" />
        </div>
        {operations.map((operation) => (
          <OperationRow key={operation.id} operation={operation} accounts={accounts} />
        ))}
      </Rows>
    </div>
  )
}
