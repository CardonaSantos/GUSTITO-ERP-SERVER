import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { CreateAnalyticsDto } from './dto/create-analytics.dto';
import { UpdateAnalyticsDto } from './dto/update-analytics.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('test')
  async getTest() {
    return this.analyticsService.getTendenciaVentasDiarias();
  }

  @Get('dashboard-summary/:userId')
  async getVendedorDashboardData(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.analyticsService.getVendedorDashboardData(userId);
  }

  @Get('/get-ventas/mes/:id')
  getVentasMes(@Param('id', ParseIntPipe) id: number) {
    return this.analyticsService.getVentasMes(id);
  }

  @Get('/get-ventas/semana/:id')
  getVentasDia(@Param('id', ParseIntPipe) id: number) {
    return this.analyticsService.getTotalVentasMontoSemana(id);
  }

  //PARA EL CHART DEL DASHBOARD:
  @Get('/get-ventas/semanal-chart/:id')
  getVentasSemanalChart(@Param('id', ParseIntPipe) id: number) {
    return this.analyticsService.getVentasSemanalChart(id);
  }

  //PRODUCTOSD MÁS VENDIDOS
  @Get('/get-productos-mas-vendidos/')
  getProductosMasVendidos() {
    return this.analyticsService.getProductosMasVendidos();
  }

  @Get('/get-ventas-recientes/')
  getVentasRecientes() {
    return this.analyticsService.getVentasRecientes();
  }
}
