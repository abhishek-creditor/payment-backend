/*
  Warnings:

  - You are about to drop the column `idempotencyKey` on the `Order` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('ORDER_CREATED', 'ORDER_UPDATED', 'PAYMENT_INITIATED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_INITIATED', 'REFUND_SUCCEEDED', 'REFUND_FAILED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_CANCELLED', 'WEBHOOK_RECEIVED', 'API_KEY_CREATED', 'API_KEY_REVOKED');

-- DropIndex
DROP INDEX "Order_idempotencyKey_idx";

-- DropIndex
DROP INDEX "Order_idempotencyKey_key";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "idempotencyKey";

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "paymentStatus" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceName" TEXT NOT NULL,
    "eventType" "AuditEventType" NOT NULL,
    "status" "AuditStatus" NOT NULL,
    "productId" TEXT,
    "apiKeyId" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "subscriptionId" TEXT,
    "ipAddress" TEXT,
    "httpMethod" TEXT,
    "path" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_productId_idx" ON "AuditLog"("productId");

-- CreateIndex
CREATE INDEX "AuditLog_apiKeyId_idx" ON "AuditLog"("apiKeyId");

-- CreateIndex
CREATE INDEX "AuditLog_orderId_idx" ON "AuditLog"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_paymentId_idx" ON "AuditLog"("paymentId");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

-- CreateIndex
CREATE INDEX "AuditLog_status_idx" ON "AuditLog"("status");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
