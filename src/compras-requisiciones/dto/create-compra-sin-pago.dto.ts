export interface CreateCompraSinCargoFromRequisicionDto {
  requisicionID: number;
  userID: number;

  /**
   * Opcional.
   * Puede existir proveedor para trazabilidad, pero NO genera pago,
   * NO genera deuda y NO genera movimiento financiero.
   */
  proveedorId?: number | null;

  /**
   * Opcional.
   * Si no viene, se usa la sucursal de la requisición.
   */
  sucursalId?: number | null;

  /**
   * Observación visible para la recepción.
   */
  observaciones?: string | null;
}
