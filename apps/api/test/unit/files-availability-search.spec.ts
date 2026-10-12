import { StockMode } from '@prisma/client';
import { availabilityFor } from '../../src/modules/catalog/availability';
import {
  sniffMime,
  stripJpegMetadata,
  stripPngMetadata,
} from '../../src/modules/storage/file-inspection';
import { toPrefixQuery } from '../../src/modules/search/search.service';
import { segmentFor } from '../../src/modules/merchants/merchant-public';
import { jpegWithExif, PNG_1PX } from '../helpers';

describe('upload inspection', () => {
  it('sniffs real content types and ignores extensions', () => {
    expect(sniffMime(PNG_1PX)).toBe('image/png');
    expect(sniffMime(jpegWithExif())).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('removes EXIF (incl. GPS) from JPEGs and keeps image data', () => {
    const src = jpegWithExif();
    const out = stripJpegMetadata(src);
    expect(out.toString('latin1')).not.toContain('GPSLatitude');
    expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(out.subarray(-2).toString('hex')).toBe('ffd9');
    expect(out.toString('latin1')).toContain('JFIF');
  });

  it('removes text/EXIF chunks from PNGs', () => {
    const textChunk = Buffer.concat([
      Buffer.from([0, 0, 0, 8]),
      Buffer.from('tEXt'),
      Buffer.from('GPS=1,2\0'),
      Buffer.alloc(4),
    ]);
    const png = Buffer.concat([PNG_1PX.subarray(0, 33), textChunk, PNG_1PX.subarray(33)]);
    const out = stripPngMetadata(png);
    expect(out.toString('latin1')).not.toContain('GPS=');
    expect(out.equals(PNG_1PX)).toBe(true);
  });
});

describe('availability messaging', () => {
  it('never promises stock for unconfirmed listings', () => {
    expect(availabilityFor(StockMode.CONFIRM_ON_ORDER, 0, null).code).toBe('CONFIRM_ON_ORDER');
    expect(availabilityFor(StockMode.MADE_TO_ORDER, 2, null).label).toMatch(/2 days/);
    expect(availabilityFor(StockMode.TRACKED, 0, { quantity: 3, reserved: 3 }).purchasable).toBe(
      false,
    );
    expect(availabilityFor(StockMode.TRACKED, 0, { quantity: 6, reserved: 2 })).toMatchObject({
      code: 'LOW_STOCK',
      quantityHint: 4,
    });
    expect(availabilityFor(StockMode.TRACKED, 0, { quantity: 60, reserved: 0 }).code).toBe(
      'IN_STOCK',
    );
  });
});

describe('search query building', () => {
  it('produces safe prefix tsqueries', () => {
    expect(toPrefixQuery('Red  Ankara!')).toBe('red:* & ankara:*');
    expect(toPrefixQuery("'; DROP TABLE x; --")).toBe('drop:* & table:* & x:*');
    expect(toPrefixQuery('!!!')).toBeNull();
  });
});

describe('reporting segments', () => {
  it('classifies merchants', () => {
    expect(segmentFor('MALL_RETAILER', ['galaxy-mall'])).toBe('GALAXY_MALL');
    expect(segmentFor('MARKET_TRADER', ['kaduna-central-market'])).toBe('OTHER_MARKET');
    expect(segmentFor('HOME_VENDOR', [])).toBe('HOME_VENDOR');
    expect(segmentFor('INDEPENDENT_SHOP', [])).toBe('INDEPENDENT');
  });
});
