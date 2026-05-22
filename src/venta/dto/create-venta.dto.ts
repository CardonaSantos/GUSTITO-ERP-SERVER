import { MetodoPago, TipoComprobante } from '@prisma/client';
import {
  IsDate,
  IsArray,
  IsEnum,
  IsNumber,
  IsInt,
  IsString,
  IsOptional,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EmpaqueVentaDto {
  @IsInt()
  productoId: number;

  @IsNumber()
  @Min(1)
  cantidad: number;
}

export class CreateVentaDto {
  @IsDate()
  @IsOptional()
  fechaVenta?: Date;

  @IsString()
  @IsOptional()
  referenciaPago?: string;

  @IsEnum(TipoComprobante)
  tipoComprobante: TipoComprobante;

  @IsNumber()
  @IsOptional()
  clienteId?: number;

  @IsOptional()
  @IsString()
  actorRol?: string;

  @IsNumber()
  @IsOptional()
  usuarioId?: number;

  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  apellidos?: string;

  @IsString()
  @IsOptional()
  dpi?: string;

  @IsString()
  @IsOptional()
  nit?: string;

  @IsString()
  @IsOptional()
  iPInternet?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsOptional()
  direccion?: string;

  @IsArray()
  productos: Array<{
    productoId?: number;
    cantidad: number;
    selectedPriceId: number;
    presentacionId?: number | null;
    precioSeleccionadoId?: number;
  }>;

  // NUEVO: consumibles sin precio
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmpaqueVentaDto)
  empaques?: EmpaqueVentaDto[];

  @IsEnum(MetodoPago)
  metodoPago: MetodoPago;

  @IsNumber()
  monto?: number;

  @IsInt()
  sucursalId: number;

  @IsString()
  @IsOptional()
  imei?: string;

  @IsString()
  @IsOptional()
  observaciones?: string;
}
