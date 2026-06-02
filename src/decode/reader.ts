/**
 * Tiny little-endian byte reader over a DataView. No allocations beyond slices.
 * Throws {@link DecodeError} naming the field on underrun.
 */

import { DecodeError } from '../errors.js';
import { encodeBase58 } from '../input/encoding.js';

export class Reader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private ensure(n: number, field: string): void {
    if (this.offset + n > this.bytes.length) {
      throw new DecodeError(
        'DECODE_FAILED',
        `unexpected end while reading ${field} (need ${n} bytes at offset ${this.offset}, have ${this.remaining})`,
      );
    }
  }

  u8(field = 'u8'): number {
    this.ensure(1, field);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(field = 'u16'): number {
    this.ensure(2, field);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(field = 'u32'): number {
    this.ensure(4, field);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u64(field = 'u64'): bigint {
    this.ensure(8, field);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  i64(field = 'i64'): bigint {
    this.ensure(8, field);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  bytes_(n: number, field = 'bytes'): Uint8Array {
    this.ensure(n, field);
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /** Read a 32-byte pubkey and return base58. */
  pubkey(field = 'pubkey'): string {
    return encodeBase58(this.bytes_(32, field));
  }

  /**
   * Solana compact-u16 (a.k.a. ShortVec) length prefix. 1–3 bytes, 7 bits each.
   */
  compactU16(field = 'compact-u16'): number {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 3; i++) {
      const byte = this.u8(`${field} length byte`);
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value >>> 0;
      shift += 7;
    }
    return value >>> 0;
  }

  /** Remaining bytes (no copy). */
  rest(): Uint8Array {
    const out = this.bytes.subarray(this.offset);
    this.offset = this.bytes.length;
    return out;
  }
}
