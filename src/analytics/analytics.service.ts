import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateAnalyticsDto } from './dto/create-analytics.dto';
import { UpdateAnalyticsDto } from './dto/update-analytics.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { dayjs } from 'src/utils/dayjs';
import { Prisma } from '@prisma/client';

const ventaMesSelect = Prisma.validator<Prisma.VentaSelect>()({
  id: true,
  fechaVenta: true,
  totalVenta: true,
});
type VentaMesRow = Prisma.VentaGetPayload<{
  select: typeof ventaMesSelect;
}>;

type VentaMesAgrupada = {
  key: string;
  label: string;
  total: number;
  cantidadVentas: number;
  ventas: VentaMesRow[];
};

type ComparativoMesChartItem = {
  mesNumero: number;
  anio: number;
  mes: string;
  label: string;
  totalVentas: number;
  porcentaje: number;
  esMesActual: boolean;
};

type VentasDiaSemanaChartItem = {
  diaNumero: number;
  dia: string;
  totalVentas: number;
  cantidadVentas: number;
  porcentaje: number;
};

type TendenciaVentasDiariasItem = {
  fecha: string;
  label: string;
  dia: string;
  mes: string;
  anio: number;
  totalVentas: number;
  cantidadVentas: number;
};

type TendenciaVentasDiariasResponse = {
  rangoMeses: number;
  fechaInicio: string;
  fechaFin: string;
  totalPeriodo: number;
  cantidadVentasPeriodo: number;
  data: TendenciaVentasDiariasItem[];
};

type AnalyticsBlock<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

type MejorMesAnalytics = {
  mes: string | null;
  totalVentas: number;
  cantidadVentas: number;
};

type MejorDiaAnalytics = {
  dia: string | null;
  diaNumero: number | null;
  totalVentas: number;
  cantidadVentas: number;
};

type CategoriaTopAnalytics = {
  categoriaId: number | null;
  categoriaNombre: string | null;
  totalVentas: number;
  cantidadVendida: number;
  productosVendidos: number;
};

type TransaccionesMesAnalytics = {
  transacciones: number;
  diasActivos: number;
};

type ComparativoVentasPorMesResponse = {
  totalPeriodo: number;
  data: ComparativoMesChartItem[];
};

type VentasDiaSemanaResponse = {
  data: VentasDiaSemanaChartItem[];
};

type TopProductoIngresoItem = {
  ranking: number;
  productoId: number | null;
  productoNombre: string;
  totalVentas: number;
  cantidadVendida: number;
  porcentajeBarra: number;
};

type TopCategoriaIngresoItem = {
  ranking: number;
  categoriaId: number;
  categoriaNombre: string;
  totalVentas: number;
  cantidadVendida: number;
  porcentajeBarra: number;
};

type TopProductosPorIngresoResponse = {
  rangoMeses: number;
  fechaInicio: string;
  fechaFin: string;
  data: TopProductoIngresoItem[];
};

type TopCategoriasPorIngresoResponse = {
  rangoMeses: number;
  fechaInicio: string;
  fechaFin: string;
  data: TopCategoriaIngresoItem[];
};

type DashboardVentasAnalyticsResponse = {
  meta: {
    rangoMeses: number;
    idSucursal: number | null;
    generadoEn: string;
  };

  resumen: {
    mejorMes: AnalyticsBlock<MejorMesAnalytics>;
    mejorDia: AnalyticsBlock<MejorDiaAnalytics>;
    categoriaTop: AnalyticsBlock<CategoriaTopAnalytics>;
    transaccionesMes: AnalyticsBlock<TransaccionesMesAnalytics>;
  };

  charts: {
    comparativoVentasPorMes: AnalyticsBlock<ComparativoVentasPorMesResponse>;
    ventasPorDiaSemana: AnalyticsBlock<VentasDiaSemanaResponse>;
    tendenciaVentasDiarias: AnalyticsBlock<TendenciaVentasDiariasResponse>;
    topProductosPorIngreso: AnalyticsBlock<TopProductosPorIngresoResponse>;
    topCategoriasPorIngreso: AnalyticsBlock<TopCategoriasPorIngresoResponse>;
    topFechasPorIngreso: AnalyticsBlock<TopFechasPorIngresoResponse>;
  };
};

type TopFechaIngresoItem = {
  ranking: number;
  fecha: string;
  label: string;
  dia: string;
  mes: string;
  anio: number;
  totalVentas: number;
  cantidadVentas: number;
  porcentajeBarra: number;
};

type TopFechasPorIngresoResponse = {
  rangoMeses: number;
  fechaInicio: string;
  fechaFin: string;
  data: TopFechaIngresoItem[];
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  constructor(private readonly prisma: PrismaService) {}

  // MAIN CALL

  private async safeAnalyticsCall<T>(
    label: string,
    callback: () => Promise<T>,
    fallback: T,
  ): Promise<AnalyticsBlock<T>> {
    try {
      const data = await callback();

      return {
        ok: true,
        data,
        error: null,
      };
    } catch (error) {
      this.logger.error(`[AnalyticsDashboard] Error en ${label}`, error);

      return {
        ok: false,
        data: fallback,
        error: `No se pudo cargar ${label}`,
      };
    }
  }

  async getDashboardVentasAnalytics(
    rangoMeses: number = 2,
    idSucursal?: number,
  ): Promise<DashboardVentasAnalyticsResponse> {
    const safeRango = Math.max(1, Math.min(Number(rangoMeses) || 2, 12));
    const safeSucursalId = idSucursal ? Number(idSucursal) : null;

    const [
      mejorMes,
      mejorDia,
      categoriaTop,
      transaccionesMes,
      comparativoVentasPorMes,
      ventasPorDiaSemana,
      tendenciaVentasDiarias,
      topProductosPorIngreso,
      topCategoriasPorIngreso,
      topFechasPorIngreso,
    ] = await Promise.all([
      this.safeAnalyticsCall<MejorMesAnalytics>(
        'mejor mes',
        () => this.getMejorMes(),
        {
          mes: null,
          totalVentas: 0,
          cantidadVentas: 0,
        },
      ),

      this.safeAnalyticsCall<MejorDiaAnalytics>(
        'mejor día',
        () => this.getMejorDia(),
        {
          dia: null,
          diaNumero: null,
          totalVentas: 0,
          cantidadVentas: 0,
        },
      ),

      this.safeAnalyticsCall<CategoriaTopAnalytics>(
        'categoría top',
        () => this.getCategoriaTop(),
        {
          categoriaId: null,
          categoriaNombre: null,
          totalVentas: 0,
          cantidadVendida: 0,
          productosVendidos: 0,
        },
      ),

      this.safeAnalyticsCall<TransaccionesMesAnalytics>(
        'transacciones del mes',
        () => this.getTransaccionesMes(),
        {
          transacciones: 0,
          diasActivos: 0,
        },
      ),

      this.safeAnalyticsCall<ComparativoVentasPorMesResponse>(
        'comparativo ventas por mes',
        () => this.getComparativoVentasPorMes(safeRango),
        {
          totalPeriodo: 0,
          data: [],
        },
      ),

      this.safeAnalyticsCall<VentasDiaSemanaResponse>(
        'ventas por día de la semana',
        () => this.getVentasPorDiaSemanaMesActual(),
        {
          data: [],
        },
      ),

      this.safeAnalyticsCall<TendenciaVentasDiariasResponse>(
        'tendencia ventas diarias',
        () => this.getTendenciaVentasDiarias(safeRango),
        {
          rangoMeses: safeRango,
          fechaInicio: '',
          fechaFin: '',
          totalPeriodo: 0,
          cantidadVentasPeriodo: 0,
          data: [],
        },
      ),

      this.safeAnalyticsCall<TopProductosPorIngresoResponse>(
        'top productos por ingreso',
        () =>
          this.getTopProductosPorIngreso(
            safeRango,
            10,
            safeSucursalId ?? undefined,
          ),
        {
          rangoMeses: safeRango,
          fechaInicio: '',
          fechaFin: '',
          data: [],
        },
      ),

      this.safeAnalyticsCall<TopCategoriasPorIngresoResponse>(
        'top categorías por ingreso',
        () =>
          this.getTopCategoriasPorIngreso(
            safeRango,
            12,
            safeSucursalId ?? undefined,
          ),
        {
          rangoMeses: safeRango,
          fechaInicio: '',
          fechaFin: '',
          data: [],
        },
      ),

      this.safeAnalyticsCall<TopFechasPorIngresoResponse>(
        'top fechas por ingreso',
        () =>
          this.getTopFechasPorIngreso(
            safeRango,
            5,
            safeSucursalId ?? undefined,
          ),
        {
          rangoMeses: safeRango,
          fechaInicio: '',
          fechaFin: '',
          data: [],
        },
      ),
    ]);
    return {
      meta: {
        rangoMeses: safeRango,
        idSucursal: safeSucursalId,
        generadoEn: dayjs().toISOString(),
      },

      resumen: {
        mejorMes,
        mejorDia,
        categoriaTop,
        transaccionesMes,
      },

      charts: {
        comparativoVentasPorMes,
        ventasPorDiaSemana,
        tendenciaVentasDiarias,
        topProductosPorIngreso,
        topCategoriasPorIngreso,
        topFechasPorIngreso,
      },
    };
  }

  /**
   * Conseguir ventas del mes actual y meses anteriores según rango.
   *
   */
  async getVentasMes(idSucursal: number, rango: number = 2) {
    try {
      const safeRango = Math.min(Math.max(Number(rango) || 2, 1), 24);

      if (!idSucursal) {
        throw new BadRequestException('Sucursal requerida');
      }

      const today = dayjs();

      const startDate = today
        .subtract(safeRango - 1, 'month')
        .startOf('month')
        .toDate();

      const endDate = today.endOf('month').toDate();

      const ventas = await this.prisma.venta.findMany({
        where: {
          sucursalId: idSucursal,
          fechaVenta: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: {
          fechaVenta: 'desc',
        },
        select: ventaMesSelect,
      });

      const mesesBase = Array.from({ length: safeRango }, (_, index) => {
        const date = today.subtract(safeRango - 1 - index, 'month');

        const key = date.format('YYYY-MM');

        return {
          key,
          label: date.format('MMMM YYYY'),
          total: 0,
          cantidadVentas: 0,
          ventas: [],
        } satisfies VentaMesAgrupada;
      });

      const agrupadoInicial = mesesBase.reduce<
        Record<string, VentaMesAgrupada>
      >((acc, mes) => {
        acc[mes.key] = mes;
        return acc;
      }, {});

      const agrupado = ventas.reduce<Record<string, VentaMesAgrupada>>(
        (acc, venta) => {
          const keyMonth = dayjs(venta.fechaVenta).format('YYYY-MM');

          if (!acc[keyMonth]) {
            acc[keyMonth] = {
              key: keyMonth,
              label: dayjs(venta.fechaVenta).format('MMMM YYYY'),
              total: 0,
              cantidadVentas: 0,
              ventas: [],
            };
          }

          acc[keyMonth].total += Number(venta.totalVenta ?? 0);
          acc[keyMonth].cantidadVentas += 1;
          // acc[keyMonth].ventas.push(venta);

          return acc;
        },
        agrupadoInicial,
      );

      const data = Object.values(agrupado);

      return {
        data,
        meta: {
          sucursalId: idSucursal,
          rango: safeRango,
          desde: startDate,
          hasta: endDate,
          totalGeneral: data.reduce((acc, mes) => acc + mes.total, 0),
          cantidadVentasGeneral: data.reduce(
            (acc, mes) => acc + mes.cantidadVentas,
            0,
          ),
        },
      };
    } catch (error) {
      this.logger.error('Error generado en getVentasMes:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Error inesperado al obtener ventas por mes',
      );
    }
  }

  async getMejorMes() {
    try {
      const today = dayjs();

      const startYear = today.startOf('year').toDate();
      const endYear = today.endOf('year').toDate();

      const result = await this.prisma.$queryRaw<
        {
          mes: number;
          totalVentas: number;
          cantidadVentas: number;
        }[]
      >`
      SELECT 
        EXTRACT(MONTH FROM "fechaVenta")::int AS mes,
        SUM("totalVenta")::float AS "totalVentas",
        COUNT(*)::int AS "cantidadVentas"
      FROM "Venta"
      WHERE "fechaVenta" >= ${startYear}
        AND "fechaVenta" <= ${endYear}
      GROUP BY mes
      ORDER BY "totalVentas" DESC
      LIMIT 1;
    `;

      const mejorMes = result[0];

      const mesString = mejorMes
        ? dayjs()
            .month(mejorMes.mes - 1)
            .format('MMMM')
        : null;

      return {
        mes: mesString,
        totalVentas: mejorMes?.totalVentas ?? 0,
        cantidadVentas: mejorMes?.cantidadVentas ?? 0,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getMejorDia() {
    try {
      const today = dayjs();

      const startMonth = today.startOf('month').toDate();
      const endMonth = today.endOf('month').toDate();

      const result = await this.prisma.$queryRaw<
        {
          dia: number;
          totalVentas: number;
          cantidadVentas: number;
        }[]
      >`
      SELECT 
        EXTRACT(DAY FROM "fechaVenta")::int AS dia,
        SUM("totalVenta")::float AS "totalVentas",
        COUNT(*)::int AS "cantidadVentas"
      FROM "Venta"
      WHERE "fechaVenta" >= ${startMonth}
        AND "fechaVenta" <= ${endMonth}
      GROUP BY dia
      ORDER BY "totalVentas" DESC
      LIMIT 1;
    `;

      const mejorDia = result[0];

      const diaString = mejorDia
        ? dayjs().date(mejorDia.dia).format('DD [de] MMMM')
        : null;

      return {
        dia: diaString,
        diaNumero: mejorDia?.dia ?? null,
        totalVentas: mejorDia?.totalVentas ?? 0,
        cantidadVentas: mejorDia?.cantidadVentas ?? 0,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getCategoriaTop() {
    try {
      const result = await this.prisma.$queryRaw<
        {
          categoriaId: number;
          categoriaNombre: string;
          totalVentas: number;
          cantidadVendida: number;
          productosVendidos: number;
        }[]
      >`
      SELECT
        c."id" AS "categoriaId",
        c."nombre" AS "categoriaNombre",
        SUM(vp."cantidad" * vp."precioVenta")::float AS "totalVentas",
        SUM(vp."cantidad")::int AS "cantidadVendida",
        COUNT(vp."id")::int AS "productosVendidos"
      FROM "VentaProducto" vp
      INNER JOIN "Venta" v ON v."id" = vp."ventaId"
      INNER JOIN "Producto" p ON p."id" = vp."productoId"
      INNER JOIN "_CategoriaToProducto" cp ON cp."B" = p."id"
      INNER JOIN "Categoria" c ON c."id" = cp."A"
      WHERE v."anulada" = false
        AND vp."estado" = 'VENDIDO'
        AND vp."productoId" IS NOT NULL
      GROUP BY c."id", c."nombre"
      ORDER BY "totalVentas" DESC
      LIMIT 1;
    `;

      const categoriaTop = result[0];

      return {
        categoriaId: categoriaTop?.categoriaId ?? null,
        categoriaNombre: categoriaTop?.categoriaNombre ?? null,
        totalVentas: categoriaTop?.totalVentas ?? 0,
        cantidadVendida: categoriaTop?.cantidadVendida ?? 0,
        productosVendidos: categoriaTop?.productosVendidos ?? 0,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getTransaccionesMes() {
    try {
      const today = dayjs();

      const startMonth = today.startOf('month').toDate();
      const endMonth = today.endOf('month').toDate();

      const result = await this.prisma.$queryRaw<
        {
          transacciones: number;
          diasActivos: number;
        }[]
      >`
      SELECT
        COUNT(v."id")::int AS "transacciones",
        COUNT(DISTINCT DATE(v."fechaVenta"))::int AS "diasActivos"
      FROM "Venta" v
      WHERE v."fechaVenta" >= ${startMonth}
        AND v."fechaVenta" <= ${endMonth}
        AND v."anulada" = false;
    `;

      const data = result[0];

      return {
        transacciones: data?.transacciones ?? 0,
        diasActivos: data?.diasActivos ?? 0,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getComparativoVentasPorMes(rango: number = 2) {
    try {
      const today = dayjs();

      const startDate = today
        .subtract(rango - 1, 'month')
        .startOf('month')
        .toDate();

      const endDate = today.endOf('month').toDate();

      const result = await this.prisma.$queryRaw<
        {
          mes: number;
          anio: number;
          totalVentas: number;
        }[]
      >`
      SELECT
        EXTRACT(MONTH FROM v."fechaVenta")::int AS mes,
        EXTRACT(YEAR FROM v."fechaVenta")::int AS anio,
        COALESCE(SUM(v."totalVenta"), 0)::float AS "totalVentas"
      FROM "Venta" v
      WHERE v."fechaVenta" >= ${startDate}
        AND v."fechaVenta" <= ${endDate}
        AND v."anulada" = false
      GROUP BY anio, mes
      ORDER BY anio ASC, mes ASC;
    `;

      const ventasMap = new Map<string, number>();

      for (const item of result) {
        ventasMap.set(`${item.anio}-${item.mes}`, item.totalVentas);
      }

      const meses: ComparativoMesChartItem[] = Array.from(
        { length: rango },
        (_, index) => {
          const date = today.subtract(rango - 1 - index, 'month');
          const mesNumero = date.month() + 1;
          const anio = date.year();

          const totalVentas = ventasMap.get(`${anio}-${mesNumero}`) ?? 0;

          return {
            mesNumero,
            anio,
            mes: date.locale('es').format('MMMM'),
            label: date.locale('es').format('MMMM YYYY'),
            totalVentas,
            porcentaje: 0,
            esMesActual:
              mesNumero === today.month() + 1 && anio === today.year(),
          };
        },
      );

      const totalPeriodo = meses.reduce(
        (acc, item) => acc + item.totalVentas,
        0,
      );

      const data = meses.map((item) => ({
        ...item,
        porcentaje:
          totalPeriodo > 0
            ? Number(((item.totalVentas / totalPeriodo) * 100).toFixed(1))
            : 0,
      }));

      return {
        totalPeriodo,
        data,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getVentasPorDiaSemanaMesActual() {
    try {
      const today = dayjs();

      const startMonth = today.startOf('month').toDate();
      const endMonth = today.endOf('month').toDate();

      const result = await this.prisma.$queryRaw<
        {
          diaNumero: number;
          totalVentas: number;
          cantidadVentas: number;
        }[]
      >`
      SELECT
        EXTRACT(DOW FROM v."fechaVenta")::int AS "diaNumero",
        COALESCE(SUM(v."totalVenta"), 0)::float AS "totalVentas",
        COUNT(v."id")::int AS "cantidadVentas"
      FROM "Venta" v
      WHERE v."fechaVenta" >= ${startMonth}
        AND v."fechaVenta" <= ${endMonth}
        AND v."anulada" = false
      GROUP BY "diaNumero"
      ORDER BY "diaNumero" ASC;
    `;

      const diasSemana = [
        { diaNumero: 0, dia: 'Domingo' },
        { diaNumero: 1, dia: 'Lunes' },
        { diaNumero: 2, dia: 'Martes' },
        { diaNumero: 3, dia: 'Miércoles' },
        { diaNumero: 4, dia: 'Jueves' },
        { diaNumero: 5, dia: 'Viernes' },
        { diaNumero: 6, dia: 'Sábado' },
      ];

      const ventasMap = new Map<
        number,
        {
          totalVentas: number;
          cantidadVentas: number;
        }
      >();

      for (const item of result) {
        ventasMap.set(item.diaNumero, {
          totalVentas: item.totalVentas,
          cantidadVentas: item.cantidadVentas,
        });
      }

      const maxVenta = Math.max(...result.map((item) => item.totalVentas), 0);

      const data: VentasDiaSemanaChartItem[] = diasSemana.map((dia) => {
        const venta = ventasMap.get(dia.diaNumero);

        const totalVentas = venta?.totalVentas ?? 0;
        const cantidadVentas = venta?.cantidadVentas ?? 0;

        return {
          diaNumero: dia.diaNumero,
          dia: dia.dia,
          totalVentas,
          cantidadVentas,
          porcentaje:
            maxVenta > 0
              ? Number(((totalVentas / maxVenta) * 100).toFixed(1))
              : 0,
        };
      });

      return {
        data,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getTendenciaVentasDiarias(
    rangoMeses: number = 2,
  ): Promise<TendenciaVentasDiariasResponse> {
    try {
      const safeRango = Math.max(1, Math.min(rangoMeses, 12));

      const today = dayjs();

      const startDate = today.subtract(safeRango - 1, 'month').startOf('month');

      const endDate = today.endOf('day');

      const result = await this.prisma.$queryRaw<
        {
          fecha: Date;
          totalVentas: number;
          cantidadVentas: number;
        }[]
      >`
      SELECT
        DATE(v."fechaVenta") AS fecha,
        COALESCE(SUM(v."totalVenta"), 0)::float AS "totalVentas",
        COUNT(v."id")::int AS "cantidadVentas"
      FROM "Venta" v
      WHERE v."fechaVenta" >= ${startDate.toDate()}
        AND v."fechaVenta" <= ${endDate.toDate()}
        AND v."anulada" = false
      GROUP BY DATE(v."fechaVenta")
      ORDER BY fecha ASC;
    `;

      const ventasMap = new Map<
        string,
        {
          totalVentas: number;
          cantidadVentas: number;
        }
      >();

      for (const item of result) {
        const fechaKey = dayjs(item.fecha).format('YYYY-MM-DD');

        ventasMap.set(fechaKey, {
          totalVentas: item.totalVentas,
          cantidadVentas: item.cantidadVentas,
        });
      }

      const data: TendenciaVentasDiariasItem[] = [];

      let cursor = startDate;

      while (cursor.isBefore(endDate, 'day') || cursor.isSame(endDate, 'day')) {
        const fechaKey = cursor.format('YYYY-MM-DD');
        const venta = ventasMap.get(fechaKey);

        data.push({
          fecha: fechaKey,
          label: cursor.format('DD/MM'),
          dia: cursor.format('DD'),
          mes: cursor.locale('es').format('MMM').toUpperCase(),
          anio: cursor.year(),
          totalVentas: venta?.totalVentas ?? 0,
          cantidadVentas: venta?.cantidadVentas ?? 0,
        });

        cursor = cursor.add(1, 'day');
      }

      const totalPeriodo = data.reduce(
        (acc, item) => acc + item.totalVentas,
        0,
      );

      const cantidadVentasPeriodo = data.reduce(
        (acc, item) => acc + item.cantidadVentas,
        0,
      );

      return {
        rangoMeses: safeRango,
        fechaInicio: startDate.format('YYYY-MM-DD'),
        fechaFin: endDate.format('YYYY-MM-DD'),
        totalPeriodo,
        cantidadVentasPeriodo,
        data,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getTopProductosPorIngreso(
    rangoMeses: number = 2,
    limit: number = 10,
    idSucursal?: number,
  ) {
    try {
      const safeRango = Math.max(1, Math.min(rangoMeses, 12));
      const safeLimit = Math.max(1, Math.min(limit, 50));

      const today = dayjs();

      const startDate = today
        .subtract(safeRango - 1, 'month')
        .startOf('month')
        .toDate();

      const endDate = today.endOf('day').toDate();

      const result = await this.prisma.$queryRaw<
        {
          productoId: number | null;
          productoNombre: string;
          totalVentas: number;
          cantidadVendida: number;
        }[]
      >`
      SELECT
        p."id" AS "productoId",
        COALESCE(p."nombre", 'Producto eliminado') AS "productoNombre",
        COALESCE(SUM(vp."cantidad" * vp."precioVenta"), 0)::float AS "totalVentas",
        COALESCE(SUM(vp."cantidad"), 0)::int AS "cantidadVendida"
      FROM "VentaProducto" vp
      INNER JOIN "Venta" v ON v."id" = vp."ventaId"
      LEFT JOIN "Producto" p ON p."id" = vp."productoId"
      WHERE v."fechaVenta" >= ${startDate}
        AND v."fechaVenta" <= ${endDate}
        AND v."anulada" = false
        AND vp."estado" = 'VENDIDO'
        ${idSucursal ? Prisma.sql`AND v."sucursalId" = ${idSucursal}` : Prisma.empty}
      GROUP BY p."id", p."nombre"
      ORDER BY "totalVentas" DESC
      LIMIT ${safeLimit};
    `;

      const maxVenta = Math.max(...result.map((item) => item.totalVentas), 0);

      const data = result.map((item, index) => ({
        ranking: index + 1,
        productoId: item.productoId,
        productoNombre: item.productoNombre,
        totalVentas: item.totalVentas,
        cantidadVendida: item.cantidadVendida,
        porcentajeBarra:
          maxVenta > 0
            ? Number(((item.totalVentas / maxVenta) * 100).toFixed(1))
            : 0,
      }));

      return {
        rangoMeses: safeRango,
        fechaInicio: dayjs(startDate).format('YYYY-MM-DD'),
        fechaFin: dayjs(endDate).format('YYYY-MM-DD'),
        data,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getTopCategoriasPorIngreso(
    rangoMeses: number = 2,
    limit: number = 12,
    idSucursal?: number,
  ) {
    try {
      const safeRango = Math.max(1, Math.min(rangoMeses, 12));
      const safeLimit = Math.max(1, Math.min(limit, 50));

      const today = dayjs();

      const startDate = today
        .subtract(safeRango - 1, 'month')
        .startOf('month')
        .toDate();

      const endDate = today.endOf('day').toDate();

      const result = await this.prisma.$queryRaw<
        {
          categoriaId: number;
          categoriaNombre: string;
          totalVentas: number;
          cantidadVendida: number;
        }[]
      >`
      SELECT
        c."id" AS "categoriaId",
        c."nombre" AS "categoriaNombre",
        COALESCE(SUM(vp."cantidad" * vp."precioVenta"), 0)::float AS "totalVentas",
        COALESCE(SUM(vp."cantidad"), 0)::int AS "cantidadVendida"
      FROM "VentaProducto" vp
      INNER JOIN "Venta" v ON v."id" = vp."ventaId"
      INNER JOIN "Producto" p ON p."id" = vp."productoId"
      INNER JOIN "_CategoriaToProducto" cp ON cp."B" = p."id"
      INNER JOIN "Categoria" c ON c."id" = cp."A"
      WHERE v."fechaVenta" >= ${startDate}
        AND v."fechaVenta" <= ${endDate}
        AND v."anulada" = false
        AND vp."estado" = 'VENDIDO'
        AND vp."productoId" IS NOT NULL
        ${idSucursal ? Prisma.sql`AND v."sucursalId" = ${idSucursal}` : Prisma.empty}
      GROUP BY c."id", c."nombre"
      ORDER BY "totalVentas" DESC
      LIMIT ${safeLimit};
    `;

      const maxVenta = Math.max(...result.map((item) => item.totalVentas), 0);

      const data = result.map((item, index) => ({
        ranking: index + 1,
        categoriaId: item.categoriaId,
        categoriaNombre: item.categoriaNombre,
        totalVentas: item.totalVentas,
        cantidadVendida: item.cantidadVendida,
        porcentajeBarra:
          maxVenta > 0
            ? Number(((item.totalVentas / maxVenta) * 100).toFixed(1))
            : 0,
      }));

      return {
        rangoMeses: safeRango,
        fechaInicio: dayjs(startDate).format('YYYY-MM-DD'),
        fechaFin: dayjs(endDate).format('YYYY-MM-DD'),
        data,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async getTopFechasPorIngreso(
    rangoMeses: number = 2,
    limit: number = 5,
    idSucursal?: number,
  ): Promise<TopFechasPorIngresoResponse> {
    try {
      const safeRango = Math.max(1, Math.min(Number(rangoMeses) || 2, 12));
      const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 30));

      const today = dayjs();

      const startDate = today
        .subtract(safeRango - 1, 'month')
        .startOf('month')
        .toDate();

      const endDate = today.endOf('day').toDate();

      const result = await this.prisma.$queryRaw<
        {
          fecha: Date;
          totalVentas: number;
          cantidadVentas: number;
        }[]
      >`
      SELECT
        DATE(v."fechaVenta") AS fecha,
        COALESCE(SUM(v."totalVenta"), 0)::float AS "totalVentas",
        COUNT(v."id")::int AS "cantidadVentas"
      FROM "Venta" v
      WHERE v."fechaVenta" >= ${startDate}
        AND v."fechaVenta" <= ${endDate}
        AND v."anulada" = false
        ${idSucursal ? Prisma.sql`AND v."sucursalId" = ${idSucursal}` : Prisma.empty}
      GROUP BY DATE(v."fechaVenta")
      ORDER BY "totalVentas" DESC
      LIMIT ${safeLimit};
    `;

      const maxVenta = Math.max(...result.map((item) => item.totalVentas), 0);

      const data: TopFechaIngresoItem[] = result.map((item, index) => {
        const fecha = dayjs(item.fecha);

        return {
          ranking: index + 1,
          fecha: fecha.format('YYYY-MM-DD'),
          label: fecha.locale('es').format('DD MMM YYYY').toUpperCase(),
          dia: fecha.format('DD'),
          mes: fecha.locale('es').format('MMM').toUpperCase(),
          anio: fecha.year(),
          totalVentas: item.totalVentas,
          cantidadVentas: item.cantidadVentas,
          porcentajeBarra:
            maxVenta > 0
              ? Number(((item.totalVentas / maxVenta) * 100).toFixed(1))
              : 0,
        };
      });

      return {
        rangoMeses: safeRango,
        fechaInicio: dayjs(startDate).format('YYYY-MM-DD'),
        fechaFin: dayjs(endDate).format('YYYY-MM-DD'),
        data,
      };
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
