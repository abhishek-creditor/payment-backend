-- CreateEnum
CREATE TYPE "OutgoingAuthType" AS ENUM ('BEARER_TOKEN', 'API_KEY_HEADER', 'BASIC_AUTH', 'HMAC_SIGNATURE', 'NONE');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('POST', 'PUT', 'PATCH', 'GET');

-- CreateTable
CREATE TABLE "ProductWebhookConfig" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "httpMethod" "HttpMethod" NOT NULL DEFAULT 'POST',
    "authType" "OutgoingAuthType" DEFAULT 'BEARER_TOKEN',
    "authSecret" TEXT,
    "headers" JSONB,
    "bodyTemplate" JSONB,
    "maxRetries" INTEGER DEFAULT 3,
    "retryDelayMs" INTEGER DEFAULT 1000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductWebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutgoingWebhookDelivery" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "orderId" TEXT,
    "attemptNumber" INTEGER DEFAULT 1,
    "statusCode" INTEGER,
    "requestBody" JSONB,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "success" BOOLEAN DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutgoingWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductWebhookConfig_productId_idx" ON "ProductWebhookConfig"("productId");

-- CreateIndex
CREATE INDEX "ProductWebhookConfig_isActive_idx" ON "ProductWebhookConfig"("isActive");

-- CreateIndex
CREATE INDEX "OutgoingWebhookDelivery_configId_idx" ON "OutgoingWebhookDelivery"("configId");

-- CreateIndex
CREATE INDEX "OutgoingWebhookDelivery_orderId_idx" ON "OutgoingWebhookDelivery"("orderId");

-- CreateIndex
CREATE INDEX "OutgoingWebhookDelivery_success_idx" ON "OutgoingWebhookDelivery"("success");

-- CreateIndex
CREATE INDEX "OutgoingWebhookDelivery_createdAt_idx" ON "OutgoingWebhookDelivery"("createdAt");

-- AddForeignKey
ALTER TABLE "ProductWebhookConfig" ADD CONSTRAINT "ProductWebhookConfig_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingWebhookDelivery" ADD CONSTRAINT "OutgoingWebhookDelivery_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ProductWebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
