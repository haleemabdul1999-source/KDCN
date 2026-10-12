import { notFound } from 'next/navigation';
import { ProductGrid } from '@/components/cards';
import { serverGet } from '@/lib/server';
import type { ListingCard } from '@/lib/types';

export const revalidate = 60;

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await serverGet<{ title: string; description: string; items: ListingCard[] }>(
    `/collections/${(await params).slug}`,
  );
  if (!c) notFound();
  return (
    <div className="stack">
      <h1>{c.title}</h1>
      {c.description && <p className="muted">{c.description}</p>}
      <ProductGrid items={c.items} />
    </div>
  );
}
