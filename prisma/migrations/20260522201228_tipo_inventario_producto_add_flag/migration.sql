-- CreateEnum
CREATE TYPE "TipoProductoInventario" AS ENUM ('PRODUCTO_VENTA', 'EMPAQUE', 'INSUMO', 'MATERIAL_OPERATIVO');

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "tipoInventario" "TipoProductoInventario" NOT NULL DEFAULT 'PRODUCTO_VENTA',
ADD COLUMN     "visibleEnPos" BOOLEAN NOT NULL DEFAULT true;
