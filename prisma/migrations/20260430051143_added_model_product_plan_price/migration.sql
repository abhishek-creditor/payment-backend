-- CreateTable
CREATE TABLE "ProductPlanPrice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "gateway" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPlanPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPlanPrice_planId_idx" ON "ProductPlanPrice"("planId");

-- CreateIndex
CREATE INDEX "ProductPlanPrice_currency_idx" ON "ProductPlanPrice"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPlanPrice_planId_currency_key" ON "ProductPlanPrice"("planId", "currency");

-- AddForeignKey
ALTER TABLE "ProductPlanPrice" ADD CONSTRAINT "ProductPlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
