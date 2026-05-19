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

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getVendedorDashboardData(userId: number) {
    try {
    } catch (error) {
      this.logger.error('error generado es: ', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Fatal error: Error inesperado');
    }
  }

  async getTotalVentasMontoSemana(sucursalId: number) {
    try {
      const guatNow = dayjs().tz('America/Guatemala');

      const daysSinceMonday = (guatNow.day() + 6) % 7;
      const startLocal = guatNow
        .subtract(daysSinceMonday, 'day')
        .startOf('day');
      const endLocal = startLocal.add(6, 'day').endOf('day');

      const startUTC = startLocal.utc().toDate();
      const endUTC = endLocal.utc().toDate();

      const ventas = await this.prisma.venta.findMany({
        where: {
          sucursalId,
          fechaVenta: {
            gte: startUTC,
            lte: endUTC,
          },
        },
        select: { totalVenta: true },
      });

      return ventas.reduce((sum, { totalVenta }) => sum + totalVenta, 0);
    } catch (error) {
      console.error('Error al calcular monto semanal:', error);
      throw new InternalServerErrorException(
        'Error al calcular el monto total de ventas de la semana',
      );
    }
  }

  async getVentasSemanalChart(sucursalId: number) {
    try {
      const guatNow = dayjs().tz('America/Guatemala');
      const primerDiaSemana = guatNow.startOf('week');
      const ultimoDiaSemana = guatNow.endOf('week');

      const ventasPorDia = await this.prisma.venta.groupBy({
        by: ['fechaVenta'],
        where: {
          sucursalId: sucursalId,
          fechaVenta: {
            gte: primerDiaSemana.toDate(),
            lte: ultimoDiaSemana.toDate(),
          },
        },
        _sum: {
          totalVenta: true,
        },
        _count: {
          id: true,
        },
      });

      const diasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const ventasSemanal = diasSemana.map((dia, index) => {
        const fecha = primerDiaSemana.add(index, 'day');
        return {
          dia,
          totalVenta: 0,
          ventas: 0,
          fecha: fecha.toISOString(),
        };
      });

      ventasPorDia.forEach((venta) => {
        const fechaVenta = dayjs(venta.fechaVenta)
          .tz('America/Guatemala')
          .startOf('day');
        const diaIndex = fechaVenta.day() === 0 ? 6 : fechaVenta.day() - 1; // Lunes = 0, Domingo = 6

        if (ventasSemanal[diaIndex]) {
          ventasSemanal[diaIndex].totalVenta += venta._sum.totalVenta || 0;
          ventasSemanal[diaIndex].ventas += venta._count.id || 0;
        }
      });

      return ventasSemanal;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'Error al calcular el monto total de ventas de la semana',
      );
    }
  }

  async getProductosMasVendidos() {
    try {
      // Consulta para obtener los 10 productos más vendidos en una sucursal específica
      const productosMasVendidos = await this.prisma.producto.findMany({
        include: {
          ventas: {
            select: {
              cantidad: true,
            },
          },
        },
      });

      // Calcular la suma total de ventas por producto
      const productosConTotalVentas = productosMasVendidos.map((producto) => {
        const totalVentas = producto.ventas.reduce(
          (total, venta) => total + venta.cantidad,
          0,
        );
        return {
          id: producto.id,
          nombre: producto.nombre,
          totalVentas,
        };
      });

      // Ordenar los productos por el total de ventas y tomar los 10 primeros
      const topProductos = productosConTotalVentas
        .sort((a, b) => b.totalVentas - a.totalVentas)
        .slice(0, 10);

      return topProductos;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'Error al calcular los productos más vendidos',
      );
    }
  }

  async getVentasRecientes() {
    try {
      const ventasRecientes = await this.prisma.venta.findMany({
        take: 10,
        orderBy: {
          fechaVenta: 'desc',
        },
        select: {
          id: true,
          fechaVenta: true,
          totalVenta: true,
          sucursal: {
            select: {
              id: true,
              nombre: true,
            },
          },
        },
      });

      return ventasRecientes;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al conseguir ventas recientes');
    }
  }

  // UTILITARIOS

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
}
