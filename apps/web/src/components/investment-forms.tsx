'use client'

import { PencilIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
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
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { declareAssetAction, recordOperationAction, renameAssetAction } from '@/lib/actions'

interface Option {
  id: string
  name: string
}

export interface AssetEntry {
  id: string
  name: string
  /** Where its price will come from, once prices exist. Absent: priced by hand. */
  pricing: string | null
}

const TYPES = [
  { value: 'buy', label: 'Achat' },
  { value: 'sell', label: 'Vente' },
  { value: 'dividend', label: 'Dividende' },
  { value: 'fee', label: 'Frais' },
] as const

type OperationType = (typeof TYPES)[number]['value']

/**
 * What happens inside an investment account. Funding the account is not here:
 * that is a transfer, declared with the movements, and the panel says so rather
 * than letting it be looked for.
 */
export function OperationForm({
  accounts,
  assets,
  today,
}: {
  accounts: Option[]
  assets: Option[]
  today: string
}) {
  const [type, setType] = useState<OperationType>('buy')
  const trade = type === 'buy' || type === 'sell'

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

      {type !== 'fee' && (
        <Field label="Actif" name="assetId">
          <FormSelect
            name="assetId"
            defaultValue={assets[0]?.id}
            options={assets.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
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
      <SubmitButton className="self-start">Déclarer</SubmitButton>
    </ActionForm>
  )
}

export interface InstrumentHit {
  source: 'yahoo' | 'coingecko'
  reference: string
  name: string
  kind: 'security' | 'crypto'
  typeLabel: string
  venue: string | null
  price: string | null
  currency: string | null
  available: boolean
}

/**
 * Finding what one holds, by whatever they know it as: a name ("msci world"),
 * a provider ("amundi"), a symbol ("CW8.PA"), an ISIN, a coin. Nobody knows a
 * Yahoo symbol by heart, so typing one was never the interface.
 *
 * Each hit shows its venue and its current price, because that is what tells
 * three listings of the same fund apart, and what confirms the right one was
 * picked. A hit priced in another currency stays visible but unselectable, with
 * its currency shown: disappearing without a word would read as "not found".
 */
function InstrumentSearch({ onPick }: { onPick: (hit: InstrumentHit) => void }) {
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

  const securities = hits.filter((h) => h.kind === 'security')
  const coins = hits.filter((h) => h.kind === 'crypto')

  const group = (label: string, items: InstrumentHit[]) =>
    items.length > 0 && (
      <CommandGroup heading={label}>
        {items.map((hit) => (
          <CommandItem
            key={`${hit.source}:${hit.reference}`}
            value={`${hit.reference} ${hit.name}`}
            disabled={!hit.available}
            onSelect={() => hit.available && onPick(hit)}
            className="items-start gap-3"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{hit.name}</span>
              <span className="truncate text-[11px] text-faint">
                {[hit.reference, hit.venue ?? hit.typeLabel].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="tabular shrink-0 text-[11.5px] text-muted-foreground">
              {hit.price
                ? `${Number(hit.price).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${hit.currency}`
                : (hit.currency ?? '')}
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
        placeholder="Nom, symbole, ISIN, fournisseur…"
        autoFocus
      />
      {query.trim().length >= 2 && (
        <CommandList className="mt-1">
          <CommandEmpty>{searching ? 'Recherche…' : 'Rien trouvé.'}</CommandEmpty>
          {group('Titres et ETF', securities)}
          {group('Cryptos', coins)}
        </CommandList>
      )}
    </Command>
  )
}

/**
 * A holding: the instrument it follows, or nothing when its price is typed by
 * hand. The instrument is shared with the other users of the application, so it
 * is picked from its source rather than described from memory.
 */
export function AssetForm() {
  const [picked, setPicked] = useState<InstrumentHit | null>(null)
  const [byHand, setByHand] = useState(false)

  if (!picked && !byHand)
    return (
      <div className="flex flex-col gap-3">
        <InstrumentSearch onPick={setPicked} />
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
    <ActionForm action={declareAssetAction} successLabel="Actif ajouté">
      {picked && (
        <>
          <input type="hidden" name="source" value={picked.source} />
          <input type="hidden" name="reference" value={picked.reference} />
          <input type="hidden" name="kind" value={picked.kind} />
          <input type="hidden" name="description" value={picked.name} />
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
            <span className="truncate text-[12.5px]">{picked.name}</span>
            <span className="text-[11px] text-faint">
              {[picked.reference, picked.venue, picked.price ? `${picked.price} ${picked.currency}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </>
      )}
      <TextField
        name="name"
        label="Sous quel nom"
        defaultValue={picked ? shortName(picked.name) : ''}
        placeholder="MSCI World"
      />
      <div className="flex items-center gap-3">
        <SubmitButton>Ajouter</SubmitButton>
        <button
          type="button"
          onClick={() => {
            setPicked(null)
            setByHand(false)
          }}
          className="text-[12px] text-muted-foreground hover:text-primary"
        >
          Changer
        </button>
      </div>
    </ActionForm>
  )
}

/** A default worth keeping: the fund's own name minus what every fund repeats. */
function shortName(name: string): string {
  return name
    .replace(/\s+(UCITS\s+)?ETF\b.*$/i, '')
    .replace(/\s+-\s+.*$/, '')
    .trim()
    .slice(0, 40)
}

function AssetRow({ asset }: { asset: AssetEntry }) {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <div className="flex items-center gap-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{asset.name}</span>
        <span className="max-w-[45%] truncate text-[11.5px] text-faint">
          {asset.pricing ?? 'cours saisi à la main'}
        </span>
        <RowMenu label={asset.name}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            Renommer
          </DropdownMenuItem>
        </RowMenu>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{asset.name}</DialogTitle>
          </DialogHeader>
          <ActionForm
            action={renameAssetAction}
            onSuccess={() => setEditing(false)}
            successLabel="Actif renommé"
          >
            <input type="hidden" name="assetId" value={asset.id} />
            <TextField name="name" label="Nom" defaultValue={asset.name} />
            <Label className="text-[11px] text-faint">{asset.pricing ?? 'Cours saisi à la main'}</Label>
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AssetRows({ assets }: { assets: AssetEntry[] }) {
  return (
    <Rows>
      {assets.map((asset) => (
        <AssetRow key={asset.id} asset={asset} />
      ))}
    </Rows>
  )
}
