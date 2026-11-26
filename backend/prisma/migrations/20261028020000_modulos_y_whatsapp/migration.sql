ALTER TABLE "Organization" ADD COLUMN     "coveragesEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Organization" ALTER COLUMN "coveragesEnabled" SET DEFAULT false;

ALTER TABLE "Patient" ADD COLUMN     "phoneHasWhatsapp" BOOLEAN NOT NULL DEFAULT true;
