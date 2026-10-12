import { BadRequestException } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';

/** Parse untrusted input with a zod schema, returning 400 with field errors on failure. */
export function parse<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export const zId = z.string().uuid();
export const zMinor = z.number().int().min(0).max(2_000_000_000);
export const zSlug = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and hyphens only');
export const zPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'enter a valid phone number');
export const zText = (max: number) => z.string().trim().max(max);

export const zPage = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function pageArgs(p: { page: number; pageSize: number }) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
