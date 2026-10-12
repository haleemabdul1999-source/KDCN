'use client';

import { ListingForm } from '@/components/ListingForm';
import { useMerchant } from '@/components/MerchantContext';

export default function NewProduct() {
  const { m } = useMerchant();
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h2>Add a product</h2>
      <p className="small muted">You can add photos after saving.</p>
      <ListingForm merchantId={m.id} merchantType={m.type} />
    </div>
  );
}
