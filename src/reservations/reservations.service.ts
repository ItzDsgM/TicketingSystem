import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { CreateReservationDto } from './dtos/create-reservation.dto';
import { User } from '../users/entities/user.entity';
import { Showtime } from '../showtimes/entities/showtime.entity';
import { SeatHold, SeatHoldStatus } from '../seat-holds/entities/seat-hold.entity';
import { Ticket, TicketStatus } from '../tickets/entities/ticket.entity';
import { SeatType } from '../rooms/entities/seat.entity';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ValidRoles } from '../common/enums/valid-roles.enum';
import {
  FilterMyReservationsDto,
  ReservationTimeframe,
} from './dtos/filter-my-reservations.dto';

export interface MyReservationsSummary {
  totalReservations: number;
  upcomingCount: number;
  pastCount: number;
}

export interface MyReservationsGrouped {
  summary: MyReservationsSummary;
  upcoming: Reservation[];
  past: Reservation[];
}

export type MyReservationsResult = MyReservationsGrouped | Reservation[];

/** Multiplicador aplicado al precio base cuando el asiento es VIP y no se define VIP_PRICE_MULTIPLIER. */
export const DEFAULT_VIP_PRICE_MULTIPLIER = 1.5;

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  private readonly VIP_PRICE_MULTIPLIER: number;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.VIP_PRICE_MULTIPLIER = this.resolveVipPriceMultiplier();
  }

  /**
   * Precio unitario de un asiento: solo los asientos VIP se multiplican,
   * los NORMAL conservan el precio base de la función.
   */
  calculateSeatPrice(basePrice: number, seatType: SeatType): number {
    const multiplier = seatType === SeatType.VIP ? this.VIP_PRICE_MULTIPLIER : 1;
    return this.roundCurrency(basePrice * multiplier);
  }

  /** Redondea a 2 decimales, igual que las columnas numeric(10,2). */
  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private resolveVipPriceMultiplier(): number {
    const raw = this.configService.get<string>('VIP_PRICE_MULTIPLIER');
    if (raw === undefined || raw === '') return DEFAULT_VIP_PRICE_MULTIPLIER;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `Invalid VIP_PRICE_MULTIPLIER "${raw}", falling back to ${DEFAULT_VIP_PRICE_MULTIPLIER}`,
      );
      return DEFAULT_VIP_PRICE_MULTIPLIER;
    }
    return parsed;
  }

  /**
   * Confirma una reserva, transicionando los SeatHolds a CONFIRMED
   * y generando los Tickets (ACID).
   */
  async confirmReservation(dto: CreateReservationDto): Promise<Reservation> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      const user = await queryRunner.manager.findOneBy(User, { id: dto.userId });
      if (!user) throw new NotFoundException('User not found');

      const showtime = await queryRunner.manager.findOneBy(Showtime, { id: dto.showtimeId });
      if (!showtime) throw new NotFoundException('Showtime not found');

      // Obtener SeatHolds y bloquearlos (Pessimistic Write) para evitar que
      // el cronjob de expiración los marque como EXPIRED mientras pagamos.
      // Solo se bloquea la fila del hold: FOR UPDATE no se puede aplicar al lado nullable de un LEFT JOIN.
      const lockedHolds = await queryRunner.manager.find(SeatHold, {
        where: { id: In(dto.seatHoldIds), user: { id: user.id }, showtime: { id: showtime.id } },
        lock: { mode: 'pessimistic_write' },
      });

      if (lockedHolds.length !== dto.seatHoldIds.length) {
        throw new BadRequestException('Some seat holds are invalid, expired or do not belong to the user');
      }

      // Validar estado de los holds
      for (const hold of lockedHolds) {
        if (hold.status !== SeatHoldStatus.ACTIVE) {
          throw new BadRequestException(`SeatHold ${hold.id} is not ACTIVE`);
        }
        if (hold.expiresAt < new Date()) {
          throw new BadRequestException(`SeatHold ${hold.id} has EXPIRED`);
        }
      }

      // Con las filas ya bloqueadas, cargar los asientos para conocer su tipo (NORMAL / VIP)
      const holds = await queryRunner.manager.find(SeatHold, {
        where: { id: In(lockedHolds.map((h) => h.id)) },
        relations: { seat: true },
      });

      // Precio por asiento: solo los VIP se multiplican por VIP_PRICE_MULTIPLIER
      const basePrice = Number(showtime.price);
      const seatPrices = holds.map((hold) => this.calculateSeatPrice(basePrice, hold.seat.type));
      const totalPrice = this.roundCurrency(seatPrices.reduce((sum, price) => sum + price, 0));

      // 1. Crear Reserva
      const reservation = queryRunner.manager.create(Reservation, {
        user,
        showtime,
        status: ReservationStatus.CONFIRMED,
        totalPrice,
      });
      const savedReservation = await queryRunner.manager.save(Reservation, reservation);

      // 2. Generar Tickets y marcar holds como CONFIRMED
      const tickets: Ticket[] = [];
      for (const [index, hold] of holds.entries()) {
        hold.status = SeatHoldStatus.CONFIRMED;
        await queryRunner.manager.save(SeatHold, hold);

        const ticket = queryRunner.manager.create(Ticket, {
          code: randomUUID(),
          reservation: savedReservation,
          seat: hold.seat,
          price: seatPrices[index],
        });
        tickets.push(ticket);
      }
      await queryRunner.manager.save(Ticket, tickets);

      await queryRunner.commitTransaction();

      return await this.reservationRepo.findOne({
        where: { id: savedReservation.id },
        relations: { showtime: true },
      }) as unknown as Promise<Reservation>;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error confirming reservation', error);
      throw new InternalServerErrorException('Error processing reservation');
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(): Promise<Reservation[]> {
    return this.reservationRepo.find({ relations: { user: true, showtime: true } });
  }

  async findById(id: string): Promise<Reservation> {
    const res = await this.reservationRepo.findOne({
      where: { id },
      relations: { user: true, showtime: true, tickets: { seat: true } },
    });
    if (!res) throw new NotFoundException('Reservation not found');
    return res;
  }

  /**
   * Consulta el historial de reservas del usuario autenticado,
   * discriminando entre funciones próximas (upcoming) y pasadas (past),
   * e incluyendo el estado detallado de sus boletas digitales (RF-10 / RF12).
   */
  async findMyReservations(
    userId: string,
    filterDto?: FilterMyReservationsDto,
  ): Promise<MyReservationsResult> {
    const reservations = await this.reservationRepo.find({
      where: { user: { id: userId } },
      relations: {
        showtime: { movie: true, room: true },
        tickets: { seat: true },
      },
      order: { createdAt: 'DESC' },
    });

    const now = new Date();
    const upcoming: Reservation[] = [];
    const past: Reservation[] = [];

    for (const res of reservations) {
      const showtimeDate = new Date(res.showtime.startTime);
      if (showtimeDate > now) {
        upcoming.push(res);
      } else {
        past.push(res);
      }
    }

    // Próximas: orden cronológico ascendente (la función más cercana primero)
    upcoming.sort(
      (a, b) =>
        new Date(a.showtime.startTime).getTime() - new Date(b.showtime.startTime).getTime(),
    );

    // Pasadas: orden cronológico descendente (la función más reciente primero)
    past.sort(
      (a, b) =>
        new Date(b.showtime.startTime).getTime() - new Date(a.showtime.startTime).getTime(),
    );

    if (filterDto?.timeframe === ReservationTimeframe.UPCOMING) {
      return upcoming;
    }

    if (filterDto?.timeframe === ReservationTimeframe.PAST) {
      return past;
    }

    return {
      summary: {
        totalReservations: reservations.length,
        upcomingCount: upcoming.length,
        pastCount: past.length,
      },
      upcoming,
      past,
    };
  }


  /**
   * Cancela una reserva confirmada, marcando los tickets como CANCELLED
   * y liberando los asientos asociados en una transacción ACID.
   *
   * Reglas de negocio:
   * 1. Solo el titular de la reserva o un administrador pueden cancelar.
   * 2. La reserva debe estar en estado CONFIRMED.
   * 3. La función no debe haber iniciado aún (cancelable hasta startTime).
   * 4. Ningún ticket de la reserva debe estar en estado USED.
   * 5. Los SeatHolds asociados en CONFIRMED se eliminan para que los asientos queden libres al instante.
   */
  async cancelReservation(id: string, user: AuthenticatedUser): Promise<Reservation> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      // 1. Bloqueo pesimista de la reserva (sin joins para prevenir incompatibilidad de Postgres FOR UPDATE)
      const lockedReservation = await queryRunner.manager.findOne(Reservation, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedReservation) {
        throw new NotFoundException('Reservation not found');
      }

      // Cargar relaciones necesarias de la reserva
      const reservation = await queryRunner.manager.findOneOrFail(Reservation, {
        where: { id: lockedReservation.id },
        relations: { user: true, showtime: true },
      });

      // 2. Control de acceso: solo el titular de la reserva o un ADMIN
      const isOwner = reservation.user.id === user.id;
      const isAdmin = user.roles.includes(ValidRoles.ADMIN);
      if (!isOwner && !isAdmin) {
        throw new ForbiddenException('You can only cancel your own reservations');
      }

      // 3. Validar estado de la reserva
      if (reservation.status === ReservationStatus.CANCELLED) {
        throw new BadRequestException('Reservation is already cancelled');
      }
      if (reservation.status !== ReservationStatus.CONFIRMED) {
        throw new BadRequestException('Only confirmed reservations can be cancelled');
      }

      // 4. Validar que la función no haya comenzado
      if (new Date() >= new Date(reservation.showtime.startTime)) {
        throw new BadRequestException('Cannot cancel reservation: showtime has already started');
      }

      // 5. Bloquear pesimista los tickets asociados
      const lockedTickets = await queryRunner.manager.find(Ticket, {
        where: { reservation: { id: reservation.id } },
        lock: { mode: 'pessimistic_write' },
      });

      const tickets = await queryRunner.manager.find(Ticket, {
        where: { id: In(lockedTickets.map((t) => t.id)) },
        relations: { seat: true },
      });

      // 6. Validar que ningún ticket haya sido usado
      const hasUsedTicket = tickets.some((t) => t.status === TicketStatus.USED);
      if (hasUsedTicket) {
        throw new BadRequestException(
          'Cannot cancel reservation: one or more tickets have already been used',
        );
      }

      // 7. Transición atómica de estados
      reservation.status = ReservationStatus.CANCELLED;
      await queryRunner.manager.save(Reservation, reservation);

      for (const ticket of tickets) {
        ticket.status = TicketStatus.CANCELLED;
      }
      if (tickets.length > 0) {
        await queryRunner.manager.save(Ticket, tickets);
      }

      // 8. Liberación de asientos: remover los SeatHolds en CONFIRMED (Opción A)
      const seatIds = tickets
        .map((t) => t.seat?.id)
        .filter((seatId): seatId is string => Boolean(seatId));

      if (seatIds.length > 0) {
        const confirmedHolds = await queryRunner.manager.find(SeatHold, {
          where: {
            showtime: { id: reservation.showtime.id },
            seat: { id: In(seatIds) },
            status: SeatHoldStatus.CONFIRMED,
          },
        });
        if (confirmedHolds.length > 0) {
          await queryRunner.manager.remove(SeatHold, confirmedHolds);
        }
      }

      await queryRunner.commitTransaction();

      return (await this.reservationRepo.findOne({
        where: { id: reservation.id },
        relations: { user: true, showtime: true, tickets: { seat: true } },
      })) as Reservation;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error('Error cancelling reservation', error);
      throw new InternalServerErrorException('Error processing reservation cancellation');
    } finally {
      await queryRunner.release();
    }
  }
}

