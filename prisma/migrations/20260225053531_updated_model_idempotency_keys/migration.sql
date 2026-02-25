/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `ProductPlan` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "IdempotencyKey" ADD COLUMN     "checkoutUrl" TEXT,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "paymentId" TEXT;

-- CreateIndex
CREATE INDEX "IdempotencyKey_orderId_idx" ON "IdempotencyKey"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPlan_code_key" ON "ProductPlan"("code");
