/*
  Warnings:

  - You are about to drop the column `idempotencyKey` on the `Order` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Order_idempotencyKey_idx";

-- DropIndex
DROP INDEX "Order_idempotencyKey_key";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "idempotencyKey";
