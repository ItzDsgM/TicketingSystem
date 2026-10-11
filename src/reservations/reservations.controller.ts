import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dtos/create-reservation.dto';
import { FilterMyReservationsDto } from './dtos/filter-my-reservations.dto';
import { Auth, GetUser } from '../common/decorators';
import { ValidRoles } from '../common/enums/valid-roles.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

@ApiTags('reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post('confirm')
  @Auth(ValidRoles.CUSTOMER, ValidRoles.ADMIN)
  @ApiOperation({ summary: 'Confirmar reserva y generar tickets a partir de bloqueos (SeatHolds)' })
  @ApiResponse({
    status: 201,
    description:
      'Reserva confirmada y tickets generados. Cada ticket guarda su precio: los asientos VIP cuestan el precio base × VIP_PRICE_MULTIPLIER (1.5 por defecto) y los NORMAL el precio base.',
  })
  @ApiResponse({ status: 400, description: 'SeatHolds inválidos o expirados' })
  confirm(@Body() dto: CreateReservationDto, @GetUser('id') userId: string) {
    return this.reservationsService.confirmReservation({ ...dto, userId });
  }

  @Get()
  @Auth(ValidRoles.ADMIN)
  @ApiOperation({ summary: 'Listar todas las reservas' })
  findAll() {
    return this.reservationsService.findAll();
  }

  @Get('me')
  @Auth(ValidRoles.CUSTOMER, ValidRoles.ADMIN)
  @ApiOperation({
    summary:
      'Obtener historial de reservas y boletas del usuario autenticado (próximas vs pasadas y estado de boletas)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Historial de reservas obtenido exitosamente. Retorna { summary, upcoming, past } o la lista filtrada por timeframe.',
  })
  findMyReservations(
    @GetUser('id') userId: string,
    @Query() filterDto: FilterMyReservationsDto,
  ) {
    return this.reservationsService.findMyReservations(userId, filterDto);
  }

  @Get(':id')

  @Auth()
  @ApiOperation({ summary: 'Obtener reserva por ID (solo el dueño o un admin)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    const reservation = await this.reservationsService.findById(id);
    if (reservation.user.id !== user.id && !user.roles.includes(ValidRoles.ADMIN)) {
      throw new ForbiddenException('You can only see your own reservations');
    }
    return reservation;
  }

  @Patch(':id/cancel')
  @Auth(ValidRoles.CUSTOMER, ValidRoles.ADMIN)
  @ApiOperation({ summary: 'Cancelar una reserva confirmada y liberar los asientos' })
  @ApiResponse({ status: 200, description: 'Reserva cancelada exitosamente y asientos liberados' })
  @ApiResponse({
    status: 400,
    description: 'La reserva ya está cancelada, la función ya inició o tiene tickets usados',
  })
  @ApiResponse({
    status: 403,
    description: 'Solo el titular de la reserva o un administrador pueden cancelarla',
  })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.reservationsService.cancelReservation(id, user);
  }
}

