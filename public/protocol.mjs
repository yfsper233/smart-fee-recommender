export function decodeTransaction(raw) {
  const tx = Array.isArray(raw)
    ? { txid: raw[0], fee: raw[1], vsize: raw[2], rate: raw[4] }
    : raw;
  if (!tx || !/^[0-9a-f]{64}$/i.test(tx.txid) || !Number.isFinite(tx.vsize) || tx.vsize <= 0) throw Error('invalid_transaction');
  const weight = tx.vsize * 4;
  const rate = tx.rate ?? (tx.fee / tx.vsize);
  if (!Number.isSafeInteger(weight) || !Number.isFinite(rate) || rate < 0) throw Error('invalid_transaction');
  return { txid: tx.txid, weight, rate };
}

export function applyProjectedBlock(previous, payload) {
  if (!payload || payload.index !== 0 || !Number.isSafeInteger(payload.sequence)) throw Error('invalid_block');
  if (Array.isArray(payload.blockTransactions)) {
    const transactions = new Map();
    for (const raw of payload.blockTransactions) {
      const tx = decodeTransaction(raw);
      if (transactions.has(tx.txid)) throw Error('duplicate_transaction');
      transactions.set(tx.txid, tx);
    }
    return { sequence: payload.sequence, transactions };
  }
  if (!previous || payload.sequence !== previous.sequence + 1) throw Error('sequence_gap');
  const delta = payload.delta;
  if (!delta || !Array.isArray(delta.added) || !Array.isArray(delta.removed) || !Array.isArray(delta.changed)) throw Error('invalid_delta');
  const transactions = new Map(previous.transactions);
  for (const txid of delta.removed) {
    if (typeof txid !== 'string' || !transactions.delete(txid)) throw Error('unknown_removed_transaction');
  }
  for (const raw of delta.added) {
    const tx = decodeTransaction(raw);
    if (transactions.has(tx.txid)) throw Error('duplicate_added_transaction');
    transactions.set(tx.txid, tx);
  }
  for (const change of delta.changed) {
    const txid = Array.isArray(change) ? change[0] : change.txid;
    const rate = Array.isArray(change) ? change[1] : change.rate;
    if (!transactions.has(txid) || !Number.isFinite(rate) || rate < 0) throw Error('invalid_changed_transaction');
    transactions.set(txid, { ...transactions.get(txid), rate });
  }
  return { sequence: payload.sequence, transactions };
}
