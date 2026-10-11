import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Auth } from '../common/decorators/auth.decorator';
import { ValidRoles } from '../common/enums/valid-roles.enum';

import { ReportsService } from './reports.service';
import { FilterSummaryReportDto } from './dtos/filter-summary-report.dto';
import { ShowtimeReportResponseDto } from './dtos/showtime-report-response.dto';
import { SummaryReportResponseDto } from './dtos/summary-report-response.dto';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  @Auth(ValidRoles.ADMIN)
  @ApiOperation({
    summary: 'Reporte consolidado de taquilla, recaudación y ocupación',
    description:
      'Retorna métricas financieras globales de ventas, capacidad, ocupación y desglose por tipo de asiento y por película. Accesible únicamente por administradores.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen consolidado calculado exitosamente',
    type: SummaryReportResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado (requiere rol ADMIN)' })
  getSummaryReport(@Query() filterDto: FilterSummaryReportDto) {
    return this.reportsService.getSummaryReport(filterDto);
  }

  @Get('showtimes/:id')
  @Auth(ValidRoles.ADMIN)
  @ApiOperation({
    summary: 'Reporte de taquilla y ocupación de una función específica',
    description:
      'Calcula las entradas vendidas (VALID y USED), capacidad de la sala, porcentaje de ocupación, recaudación total y desglose por localidad (NORMAL vs VIP). Accesible únicamente por administradores.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'UUID de la función (showtime)',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte de la función calculado exitosamente',
    type: ShowtimeReportResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado (requiere rol ADMIN)' })
  @ApiResponse({ status: 404, description: 'Función no encontrada' })
  getShowtimeReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.reportsService.getShowtimeReport(id);
  }
}
