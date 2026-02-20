/*
  Warnings:

  - A unique constraint covering the columns `[tilledCustomerId]` on the table `ProductUser` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `ProductUser` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProductUser" ADD COLUMN     "tilledCustomerCreatedAt" TIMESTAMP(3),
ADD COLUMN     "tilledCustomerId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProductUser_tilledCustomerId_key" ON "ProductUser"("tilledCustomerId");

-- CreateIndex
CREATE INDEX "ProductUser_tilledCustomerId_idx" ON "ProductUser"("tilledCustomerId");
