-- DropIndex
DROP INDEX "ProductPlan_code_key";

-- AlterTable
ALTER TABLE "ProductPlan" ALTER COLUMN "code" DROP NOT NULL;
