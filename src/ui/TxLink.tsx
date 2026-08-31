import { explorerTxUrl, truncateId } from '../explorer'

export function TxLink({ label, txId }: { label: string; txId: string }) {
  return (
    <div className="tx-link">
      <span className="tx-link__label">{label}</span>
      <a href={explorerTxUrl(txId)} target="_blank" rel="noreferrer noopener">
        {truncateId(txId, 12, 8)}
      </a>
    </div>
  )
}
