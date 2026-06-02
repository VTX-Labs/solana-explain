/**
 * Regenerate the captured-shape fixture JSON files used as documentation and
 * snapshot inputs. Run with: node test/fixtures/_generate.mjs
 *
 * These are realistic getTransaction (json-shaped, base64 message) payloads
 * built from deterministic test keys, so the repo carries reference data
 * without needing live RPC access.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bs58 from 'bs58';

const here = dirname(fileURLToPath(import.meta.url));

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function pk(seed) {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (seed * 31 + i * 7) % 256;
  b[0] = (seed + 1) % 256;
  return bs58.encode(b);
}

function compactU16(out, value) {
  let v = value;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v === 0) { out.push(byte); return; }
    out.push(byte | 0x80);
  }
}

/**
 * Minimal legacy message builder (mirrors src/decode/build-message but emits
 * only the message, base64) for fixture purposes.
 */
function buildMessage(instructions, feePayer) {
  const metaByKey = new Map();
  const upsert = (m) => {
    const cur = metaByKey.get(m.pubkey);
    if (cur) { cur.isSigner ||= m.isSigner; cur.isWritable ||= m.isWritable; }
    else metaByKey.set(m.pubkey, { ...m });
  };
  upsert({ pubkey: feePayer, isSigner: true, isWritable: true });
  for (const ix of instructions) {
    for (const a of ix.accounts) upsert({ ...a });
    upsert({ pubkey: ix.programId, isSigner: false, isWritable: false });
  }
  const all = [...metaByKey.values()];
  all.sort((a, b) => {
    if (a.pubkey === feePayer) return -1;
    if (b.pubkey === feePayer) return 1;
    const rank = (m) => (m.isSigner ? (m.isWritable ? 0 : 1) : m.isWritable ? 2 : 3);
    const r = rank(a) - rank(b);
    return r !== 0 ? r : a.pubkey.localeCompare(b.pubkey);
  });
  const numReq = all.filter((m) => m.isSigner).length;
  const numRoSigned = all.filter((m) => m.isSigner && !m.isWritable).length;
  const numRoUnsigned = all.filter((m) => !m.isSigner && !m.isWritable).length;
  const keyIndex = new Map();
  all.forEach((m, i) => keyIndex.set(m.pubkey, i));
  const out = [numReq, numRoSigned, numRoUnsigned];
  compactU16(out, all.length);
  for (const m of all) out.push(...bs58.decode(m.pubkey));
  out.push(...bs58.decode(SYSTEM)); // recent blockhash placeholder
  compactU16(out, instructions.length);
  for (const ix of instructions) {
    out.push(keyIndex.get(ix.programId));
    compactU16(out, ix.accounts.length);
    for (const a of ix.accounts) out.push(keyIndex.get(a.pubkey));
    compactU16(out, ix.data.length);
    out.push(...ix.data);
  }
  return { msgB64: Buffer.from(Uint8Array.from(out)).toString('base64'), accountKeys: all.map((m) => m.pubkey) };
}

function u64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return [...b]; }
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return [...b]; }

function sysTransfer(from, to, lamports) {
  return { programId: SYSTEM, accounts: [{ pubkey: from, isSigner: true, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }], data: [...u32(2), ...u64(lamports)] };
}
function transferChecked(src, mint, dst, auth, amount, decimals, program = TOKEN) {
  return { programId: program, accounts: [{ pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: auth, isSigner: true, isWritable: false }], data: [12, ...u64(amount), decimals] };
}
function computeLimit(units) { return { programId: COMPUTE, accounts: [], data: [2, ...u32(units)] }; }
function computePrice(micro) { return { programId: COMPUTE, accounts: [], data: [3, ...u64(micro)] }; }

function tb(accountIndex, mint, owner, amount, decimals) {
  return { accountIndex, mint, owner, programId: TOKEN, uiTokenAmount: { amount: String(amount), decimals, uiAmount: Number(amount) / 10 ** decimals, uiAmountString: String(Number(amount) / 10 ** decimals) } };
}

function txResponse({ ixs, feePayer, pre, post, preTok = [], postTok = [], fee = 5000, err = null, slot = 287330114, blockTime = 1717070520, cu = 0 }) {
  const { msgB64 } = buildMessage(ixs, feePayer);
  return {
    slot, blockTime, version: 'legacy',
    meta: { err, fee, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok, innerInstructions: [], logMessages: [], computeUnitsConsumed: cu },
    transaction: { signatures: [bs58.encode(new Uint8Array(64).fill(1))], message: [msgB64, 'base64'] },
  };
}

const PAYER = pk(1), R = pk(2), SRC = pk(10), DST = pk(11), VAULT = pk(20);

const fixtures = {
  'sol-transfer.json': txResponse({
    ixs: [sysTransfer(PAYER, R, 1_000_000_000)], feePayer: PAYER,
    pre: [2_000_000_000, 0, 1], post: [999_995_000, 1_000_000_000, 1], cu: 150,
  }),
  'spl-transfer-checked.json': txResponse({
    ixs: [transferChecked(SRC, USDC, DST, PAYER, 250_000_000, 6)], feePayer: PAYER,
    pre: [2_000_000_000, 2_039_280, 1, 2_039_280, 1], post: [1_999_995_000, 2_039_280, 1, 2_039_280, 1],
    preTok: [tb(1, USDC, PAYER, 500_000_000, 6), tb(3, USDC, R, 0, 6)],
    postTok: [tb(1, USDC, PAYER, 250_000_000, 6), tb(3, USDC, R, 250_000_000, 6)], cu: 6000,
  }),
  'jupiter-swap.json': txResponse({
    ixs: [computeLimit(200000), computePrice(1000), { programId: JUP, accounts: [{ pubkey: PAYER, isSigner: true, isWritable: true }, { pubkey: VAULT, isSigner: false, isWritable: true }], data: [1, 2, 3, 4] }, transferChecked(VAULT, USDC, SRC, PAYER, 248_910_000, 6)],
    feePayer: PAYER, pre: [2_000_000_000, 2_039_280, 2_039_280, 1, 1, 1], post: [499_985_000, 2_039_280, 2_039_280, 1, 1, 1],
    preTok: [tb(2, USDC, VAULT, 248_910_000, 6), tb(1, USDC, PAYER, 0, 6)],
    postTok: [tb(2, USDC, VAULT, 0, 6), tb(1, USDC, PAYER, 248_910_000, 6)], cu: 142318,
  }),
  'ata-create-idempotent.json': txResponse({
    ixs: [{ programId: ATA, accounts: [{ pubkey: PAYER, isSigner: true, isWritable: true }, { pubkey: DST, isSigner: false, isWritable: true }, { pubkey: R, isSigner: false, isWritable: false }, { pubkey: USDC, isSigner: false, isWritable: false }, { pubkey: SYSTEM, isSigner: false, isWritable: false }, { pubkey: TOKEN, isSigner: false, isWritable: false }], data: [1] }],
    feePayer: PAYER, pre: [2_000_000_000, 0, 1, 1, 1, 1], post: [1_997_955_720, 2_039_280, 1, 1, 1, 1], cu: 20000,
    postTok: [tb(1, USDC, R, 0, 6)],
  }),
  'token2022-transfer-fee.json': txResponse({
    ixs: [transferChecked(SRC, pk(30), DST, PAYER, 1_000_000, 6, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')], feePayer: PAYER,
    pre: [2_000_000_000, 2_039_280, 1, 2_039_280, 1], post: [1_999_995_000, 2_039_280, 1, 2_039_280, 1],
    preTok: [tb(1, pk(30), PAYER, 5_000_000, 6), tb(3, pk(30), R, 0, 6)],
    postTok: [tb(1, pk(30), PAYER, 4_000_000, 6), tb(3, pk(30), R, 990_000, 6)], cu: 8000,
  }),
  'failed-tx.json': txResponse({
    ixs: [transferChecked(SRC, USDC, DST, PAYER, 250_000_000, 6)], feePayer: PAYER,
    pre: [2_000_000_000, 2_039_280, 1, 2_039_280, 1], post: [1_999_995_000, 2_039_280, 1, 2_039_280, 1],
    preTok: [tb(1, USDC, PAYER, 100_000, 6)], postTok: [tb(1, USDC, PAYER, 100_000, 6)],
    err: { InstructionError: [0, { Custom: 1 }] }, cu: 3000,
  }),
  'wsol-wrap-unwrap.json': txResponse({
    ixs: [{ programId: TOKEN, accounts: [{ pubkey: DST, isSigner: false, isWritable: true }], data: [17] }],
    feePayer: PAYER, pre: [2_000_000_000, 0, 1], post: [1_999_995_000, 0, 1],
    preTok: [tb(1, WSOL, PAYER, 0, 9)], postTok: [tb(1, WSOL, PAYER, 1_000_000_000, 9)], cu: 5000,
  }),
};

// v0-with-lut: a minimal v0 message reference (documentation only).
const v0 = {
  slot: 287330200, blockTime: 1717070600, version: 0,
  meta: { err: null, fee: 5000, preBalances: [2_000_000_000, 0], postBalances: [1_999_995_000, 1], preTokenBalances: [], postTokenBalances: [], innerInstructions: [], loadedAddresses: { writable: [pk(50)], readonly: [pk(51)] }, computeUnitsConsumed: 200 },
  transaction: { signatures: [bs58.encode(new Uint8Array(64).fill(1))], message: [buildMessage([sysTransfer(PAYER, pk(50), 1)], PAYER).msgB64, 'base64'] },
  _note: 'Reference v0 payload; loadedAddresses populated by the node resolves LUT writable/readonly keys.',
};

for (const [name, data] of Object.entries(fixtures)) {
  writeFileSync(join(here, name), JSON.stringify(data, null, 2) + '\n');
}
writeFileSync(join(here, 'v0-with-lut.json'), JSON.stringify(v0, null, 2) + '\n');
console.log('Wrote', Object.keys(fixtures).length + 1, 'fixtures');
