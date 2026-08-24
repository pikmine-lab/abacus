import type { AssetNature, InstrumentKind } from './types.ts'

/**
 * The mass a holding belongs to, resolved from the one side that answers for
 * it. An instrument speaks for what its source types: `security` means the
 * source has not said yet, and `currency` is never held. Otherwise the asset's
 * own declaration speaks, which the schema guarantees is set exactly then.
 *
 * One function, because a holding that reads as a fund in a total and as
 * something else in a list would make the split it is there to show unreadable.
 */
export function natureOf(kind: InstrumentKind | null, declared: AssetNature | null): AssetNature {
  if (kind === 'equity' || kind === 'fund' || kind === 'crypto') return kind
  return declared ?? 'other'
}
