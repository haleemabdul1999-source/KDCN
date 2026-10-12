/**
 * Logistics provider adapter. Release 1 uses manual dispatch coordination: KDCN operations or
 * the merchant assigns a rider/partner and records status changes. A courier integration
 * implements this interface and is registered in FulfilmentService. We do not promise live
 * tracking unless the selected partner supports it.
 */
export interface DispatchRequest {
  orderNumber: string;
  pickup: { areaName: string; addressForCourier: string | null; contactPhone: string };
  dropoff: { areaName: string | null; address: string | null; recipientPhone: string | null };
  partnerName: string;
  riderName?: string;
  riderPhone?: string;
}

export interface DispatchResult {
  provider: string;
  providerRef: string | null;
  trackingUrl: string | null;
}

export interface LogisticsAdapter {
  readonly name: string;
  readonly supportsLiveTracking: boolean;
  dispatch(req: DispatchRequest): Promise<DispatchResult>;
}

export class ManualDispatchAdapter implements LogisticsAdapter {
  readonly name = 'MANUAL';
  readonly supportsLiveTracking = false;
  async dispatch(): Promise<DispatchResult> {
    return { provider: 'MANUAL', providerRef: null, trackingUrl: null };
  }
}
