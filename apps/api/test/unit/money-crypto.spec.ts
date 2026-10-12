import { applyBps, assertMinor, formatNaira } from '../../src/common/money';
import {
  base32Decode,
  base32Encode,
  decryptField,
  encryptField,
  hashPassword,
  totp,
  verifyPassword,
  verifyTotp,
} from '../../src/common/crypto';

describe('money', () => {
  it('applies basis points with integer half-up rounding', () => {
    expect(applyBps(1_000_000, 500)).toBe(50_000);
    expect(applyBps(333, 450)).toBe(15); // 14.985 → 15
    expect(applyBps(1, 4999)).toBe(0);
    expect(applyBps(0, 500)).toBe(0);
  });
  it('rejects floats, negatives and overflow', () => {
    expect(() => assertMinor(1.5)).toThrow();
    expect(() => assertMinor(-1)).toThrow();
    expect(() => assertMinor(3_000_000_000)).toThrow();
    expect(() => applyBps(100, 10001)).toThrow();
  });
  it('formats naira', () => {
    expect(formatNaira(1850000)).toBe('₦18,500');
    expect(formatNaira(1850050)).toBe('₦18,500.50');
  });
});

describe('crypto', () => {
  it('TOTP matches RFC 6238 SHA-1 test vectors (6-digit truncation)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1111111109_000)).toBe('081804');
    expect(totp(secret, 1234567890_000)).toBe('005924');
    expect(totp(secret, 2000000000_000)).toBe('279037');
    expect(verifyTotp(secret, '287082', 59_000 + 30_000)).toBe(true); // one step of drift
    expect(verifyTotp(secret, '287082', 59_000 + 120_000)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', 59_000)).toBe(false);
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('hashes and verifies passwords with scrypt', async () => {
    const h = await hashPassword('correct horse 1');
    expect(h).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(await verifyPassword('correct horse 1', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('encrypts fields with authenticated encryption', () => {
    const a = encryptField('12 Private Road');
    const b = encryptField('12 Private Road');
    expect(a).not.toBe(b); // random IV
    expect(decryptField(a)).toBe('12 Private Road');
    const tampered = a.slice(0, -4) + (a.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => decryptField(tampered)).toThrow();
    expect(decryptField(null)).toBeNull();
  });
});
