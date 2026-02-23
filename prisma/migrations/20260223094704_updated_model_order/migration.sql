/*
  Warnings:

  - Made the column `planId` on table `Order` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('ONE_TIME', 'SUBSCRIPTION', 'CANCEL', 'REFUND', 'OTHER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderType" "OrderType" NOT NULL DEFAULT 'ONE_TIME',
ALTER COLUMN "planId" SET NOT NULL;
