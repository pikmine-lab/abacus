'use client'

import { PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
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

/**
 * A holding. Its price source is what makes it quotable later; the reference
 * has to be the source's own (a Yahoo symbol, a CoinGecko id), because it is
 * shared with the other users of the application.
 */
export function AssetForm() {
  const [source, setSource] = useState('')

  return (
    <ActionForm action={declareAssetAction} successLabel="Actif ajouté">
      <TextField name="name" label="Nom" placeholder="MSCI World" />
      <Field label="Cours">
        <FormSelect
          name="source"
          noneLabel="Saisi à la main"
          onValueChange={setSource}
          options={[
            { value: 'yahoo', label: 'Yahoo Finance (action, ETF)' },
            { value: 'coingecko', label: 'CoinGecko (crypto)' },
          ]}
        />
      </Field>
      {source !== '' && (
        <>
          <Field label={source === 'yahoo' ? 'Symbole Yahoo' : 'Identifiant CoinGecko'} name="reference">
            <Input
              name="reference"
              placeholder={source === 'yahoo' ? 'CW8.PA' : 'bitcoin'}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <input type="hidden" name="kind" value={source === 'coingecko' ? 'crypto' : 'security'} />
          <TextField
            name="description"
            label="Nom de l’instrument (optionnel)"
            placeholder="Amundi MSCI World UCITS ETF"
          />
        </>
      )}
      <SubmitButton className="self-start">Ajouter</SubmitButton>
    </ActionForm>
  )
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
