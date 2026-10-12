import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AssignmentStatus, FulfilmentStatus, LocationKind } from '@prisma/client';
import { decryptField, encryptField, randomNumericCode } from '../../common/crypto';
import { PrismaService, Tx } from '../../common/prisma.service';
import { isCollection } from '../orders/order-state-machine';
import { LogisticsAdapter, ManualDispatchAdapter } from './logistics.adapter';

@Injectable()
export class FulfilmentService {
  private readonly logistics: LogisticsAdapter = new ManualDispatchAdapter();

  constructor(private readonly prisma: PrismaService) {}

  async event(
    tx: Tx,
    fulfilmentId: string,
    type: string,
    actorUserId?: string | null,
    note?: string,
  ) {
    await tx.fulfilmentEvent.create({
      data: { fulfilmentId, type, actorUserId: actorUserId ?? null, note },
    });
  }

  /** At payment: issue a collection code for collection orders. */
  async onPaid(tx: Tx, orderId: string) {
    const f = await tx.fulfilment.findUniqueOrThrow({ where: { orderId } });
    if (isCollection(f.method) && !f.collectionCodeEnc) {
      await tx.fulfilment.update({
        where: { id: f.id },
        data: { collectionCodeEnc: encryptField(randomNumericCode(6)) },
      });
    }
    await this.event(tx, f.id, 'PAYMENT_CONFIRMED');
  }

  async setStatus(
    tx: Tx,
    orderId: string,
    status: FulfilmentStatus,
    actorUserId?: string | null,
    note?: string,
  ) {
    const f = await tx.fulfilment.update({
      where: { orderId },
      data: {
        status,
        ...(status === FulfilmentStatus.DELIVERED || status === FulfilmentStatus.COLLECTED
          ? { completedAt: new Date() }
          : {}),
      },
    });
    await this.event(tx, f.id, status, actorUserId, note);
    return f;
  }

  async dispatch(
    tx: Tx,
    orderId: string,
    input: {
      partnerName: string;
      riderName?: string;
      riderPhone?: string;
      note?: string;
      logisticsCostMinor?: number;
    },
    actorUserId: string,
  ) {
    const f = await tx.fulfilment.findUniqueOrThrow({
      where: { orderId },
      include: {
        order: { include: { merchant: { include: { locations: { include: { area: true } } } } } },
      },
    });
    const merchant = f.order.merchant;
    const pickupLoc =
      merchant.locations.find((l) => l.kind === LocationKind.PRIVATE_FULFILMENT) ??
      merchant.locations[0];
    const result = await this.logistics.dispatch({
      orderNumber: f.order.number,
      pickup: {
        areaName: pickupLoc?.area.name ?? '',
        addressForCourier: pickupLoc
          ? (pickupLoc.publicAddress ?? decryptField(pickupLoc.privateAddressEnc))
          : null,
        contactPhone: merchant.contactPhone,
      },
      dropoff: {
        areaName: null,
        address: decryptField(f.deliveryAddressEnc),
        recipientPhone: f.recipientPhone,
      },
      partnerName: input.partnerName,
      riderName: input.riderName,
      riderPhone: input.riderPhone,
    });
    await tx.deliveryAssignment.updateMany({
      where: {
        fulfilmentId: f.id,
        status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.PICKED_UP] },
      },
      data: { status: AssignmentStatus.CANCELLED },
    });
    await tx.deliveryAssignment.create({
      data: {
        fulfilmentId: f.id,
        partnerName: input.partnerName,
        riderName: input.riderName,
        riderPhone: input.riderPhone,
        assignedById: actorUserId,
        note: input.note,
        status: AssignmentStatus.PICKED_UP,
      },
    });
    await tx.fulfilment.update({
      where: { id: f.id },
      data: {
        status: FulfilmentStatus.DISPATCHED,
        provider: result.provider,
        providerRef: result.providerRef,
        ...(input.logisticsCostMinor !== undefined
          ? { logisticsCostMinor: input.logisticsCostMinor }
          : {}),
      },
    });
    await this.event(
      tx,
      f.id,
      'DISPATCHED',
      actorUserId,
      `${input.partnerName}${input.riderName ? ' · ' + input.riderName : ''}`,
    );
  }

  async delivered(tx: Tx, orderId: string, actorUserId: string, note?: string) {
    const f = await tx.fulfilment.findUniqueOrThrow({ where: { orderId } });
    await tx.deliveryAssignment.updateMany({
      where: {
        fulfilmentId: f.id,
        status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.PICKED_UP] },
      },
      data: { status: AssignmentStatus.DELIVERED },
    });
    return this.setStatus(tx, orderId, FulfilmentStatus.DELIVERED, actorUserId, note);
  }

  async failedAttempt(tx: Tx, orderId: string, actorUserId: string, note: string) {
    const f = await tx.fulfilment.findUniqueOrThrow({ where: { orderId } });
    await tx.deliveryAssignment.updateMany({
      where: {
        fulfilmentId: f.id,
        status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.PICKED_UP] },
      },
      data: { status: AssignmentStatus.FAILED, note },
    });
    const updated = await tx.fulfilment.update({
      where: { id: f.id },
      data: { status: FulfilmentStatus.FAILED_ATTEMPT, failedAttempts: { increment: 1 } },
    });
    await this.event(tx, f.id, 'FAILED_ATTEMPT', actorUserId, note);
    return updated;
  }

  /**
   * Check a collection code before handover. Failed attempts are recorded outside any business
   * transaction and capped, so a code cannot be brute-forced by the counterparty.
   */
  async checkCollectionCode(orderId: string, code: string, actorUserId: string) {
    const f = await this.prisma.fulfilment.findUniqueOrThrow({ where: { orderId } });
    const failures = await this.prisma.fulfilmentEvent.count({
      where: { fulfilmentId: f.id, type: 'COLLECTION_CODE_REJECTED' },
    });
    if (failures >= 5)
      throw new ForbiddenException(
        'Too many incorrect codes. Contact KDCN support to complete this collection.',
      );
    const expected = decryptField(f.collectionCodeEnc);
    if (!expected || expected !== code.trim()) {
      await this.prisma.fulfilmentEvent.create({
        data: { fulfilmentId: f.id, type: 'COLLECTION_CODE_REJECTED', actorUserId },
      });
      throw new BadRequestException('Collection code does not match');
    }
  }
}
