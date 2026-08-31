import { formatRawAmount } from '../units'

export function BalancePanel({
  balances,
  decimals,
  loading,
  onRefresh,
}: {
  balances: { aleo: bigint; eth: bigint } | null
  decimals: { aleo: number; eth: number }
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className="balances-panel">
      <dl className="balances">
        <div className="balances__item">
          <dt>Private ALEO</dt>
          <dd>{balances ? formatRawAmount(balances.aleo, decimals.aleo) : loading ? '…' : '—'}</dd>
        </div>
        <div className="balances__item">
          <dt>Private ETH</dt>
          <dd>{balances ? formatRawAmount(balances.eth, decimals.eth) : loading ? '…' : '—'}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="button button--ghost"
        onClick={onRefresh}
        disabled={loading}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}
