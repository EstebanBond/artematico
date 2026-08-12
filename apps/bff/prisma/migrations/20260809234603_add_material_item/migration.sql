-- CreateTable
CREATE TABLE "MaterialItem" (
    "id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "week" INTEGER,
    "purchaseByDate" TIMESTAMP(3),
    "notas" TEXT,
    "comprada" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);
