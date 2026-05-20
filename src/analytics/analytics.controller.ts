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

  @Get('dashboard-ventas')
  getDashboardVentasAnalytics(
    @Query('rangoMeses') rangoMeses?: string,
    @Query('idSucursal') idSucursal?: string,
  ) {
    return this.analyticsService.getDashboardVentasAnalytics(
      rangoMeses ? Number(rangoMeses) : 2,
      idSucursal ? Number(idSucursal) : undefined,
    );
  }
}
