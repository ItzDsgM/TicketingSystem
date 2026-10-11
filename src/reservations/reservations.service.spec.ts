import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_VIP_PRICE_MULTIPLIER, ReservationsService } from './reservations.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { SeatHold, SeatHoldStatus } from '../seat-holds/entities/seat-hold.entity';
import { Ticket, TicketStatus } from '../tickets/entities/ticket.entity';
import { SeatType } from '../rooms/entities/seat.entity';
import { ValidRoles } from '../common/enums/valid-roles.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ReservationTimeframe } from './dtos/filter-my-reservations.dto';

/**
 * Suite inicial del Paso 1 (Punto 5: precios diferenciados VIP).
 * El Paso 5 (Punto 4) la amplía con el resto de flujos de ReservationsService.
 */
describe('ReservationsService', () => {
  let service: ReservationsService;
  let qrMock: any;
  let dataSourceMock: any;
  let repoMock: any;
  let configMock: { get: jest.Mock };

  const USER = { id: 'user-1' };
  const SHOWTIME = { id: 'showtime-1', price: '15000.00' }; // numeric llega como string desde pg

  const futureDate = () => new Date(Date.now() + 5 * 60 * 1000);
  const buildHold = (id: string, seatType: SeatType) => ({
    id,
    status: SeatHoldStatus.ACTIVE,
    expiresAt: futureDate(),
    seat: { id: `seat-${id}`, type: seatType },
  });

  const buildService = async (vipMultiplier?: string) => {
    configMock = { get: jest.fn().mockReturnValue(vipMultiplier) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: getRepositoryToken(Reservation), useValue: repoMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    return module.get<ReservationsService>(ReservationsService);
  };

  /** Prepara los mocks de una confirmación exitosa con los holds indicados. */
  const arrangeConfirmation = (holds: ReturnType<typeof buildHold>[]) => {
    qrMock.manager.findOneBy.mockResolvedValueOnce(USER).mockResolvedValueOnce(SHOWTIME);
    // 1ª llamada: lock sin relaciones; 2ª llamada: carga de asientos
    qrMock.manager.find
      .mockResolvedValueOnce(holds.map(({ seat, ...rest }) => rest))
      .mockResolvedValueOnce(holds);
  };

  beforeEach(async () => {
    qrMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOneBy: jest.fn(),
        findOne: jest.fn(),
        findOneOrFail: jest.fn(),
        find: jest.fn(),
        create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
        save: jest.fn((_entity: unknown, data: any) =>
          Promise.resolve(Array.isArray(data) ? data : { id: 'reservation-1', ...data }),
        ),
        remove: jest.fn().mockResolvedValue(undefined),
      },
    };
    dataSourceMock = { createQueryRunner: jest.fn().mockReturnValue(qrMock) };
    repoMock = {
      findOne: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      find: jest.fn(),
    };

    service = await buildService();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('calculateSeatPrice', () => {
    it('mantiene el precio base para asientos NORMAL', () => {
      expect(service.calculateSeatPrice(15000, SeatType.NORMAL)).toBe(15000);
    });

    it('multiplica por 1.5 por defecto los asientos VIP', () => {
      expect(DEFAULT_VIP_PRICE_MULTIPLIER).toBe(1.5);
      expect(service.calculateSeatPrice(15000, SeatType.VIP)).toBe(22500);
    });

    it('redondea a 2 decimales con precios base decimales', () => {
      // 12345.67 * 1.5 = 18518.505
      expect(service.calculateSeatPrice(12345.67, SeatType.VIP)).toBe(18518.51);
    });

    it('usa VIP_PRICE_MULTIPLIER desde ConfigService cuando está definido', async () => {
      const custom = await buildService('2');
      expect(configMock.get).toHaveBeenCalledWith('VIP_PRICE_MULTIPLIER');
      expect(custom.calculateSeatPrice(15000, SeatType.VIP)).toBe(30000);
      expect(custom.calculateSeatPrice(15000, SeatType.NORMAL)).toBe(15000);
    });

    it.each(['abc', '0', '-1'])('usa el valor por defecto si VIP_PRICE_MULTIPLIER es inválido (%s)', async (value) => {
      const fallback = await buildService(value);
      expect(fallback.calculateSeatPrice(15000, SeatType.VIP)).toBe(22500);
    });
  });

  describe('confirmReservation', () => {
    const dto = (seatHoldIds: string[]) => ({ showtimeId: SHOWTIME.id, seatHoldIds, userId: USER.id });

    const savedTickets = (): any[] => {
      const call = qrMock.manager.save.mock.calls.find(([entity]: [unknown]) => entity === Ticket);
      return call[1];
    };
    const createdReservation = (): any => {
      const call = qrMock.manager.create.mock.calls.find(([entity]: [unknown]) => entity === Reservation);
      return call[1];
    };

    it('cobra el precio base por asiento cuando todos son NORMAL', async () => {
      arrangeConfirmation([buildHold('h1', SeatType.NORMAL), buildHold('h2', SeatType.NORMAL)]);

      await service.confirmReservation(dto(['h1', 'h2']));

      expect(createdReservation().totalPrice).toBe(30000);
      expect(createdReservation().status).toBe(ReservationStatus.CONFIRMED);
      expect(savedTickets().map((t) => t.price)).toEqual([15000, 15000]);
      expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('multiplica solo el ticket VIP en una reserva mixta', async () => {
      arrangeConfirmation([
        buildHold('h1', SeatType.VIP),
        buildHold('h2', SeatType.NORMAL),
        buildHold('h3', SeatType.NORMAL),
      ]);

      await service.confirmReservation(dto(['h1', 'h2', 'h3']));

      // 22500 (VIP) + 15000 + 15000
      expect(createdReservation().totalPrice).toBe(52500);
      const tickets = savedTickets();
      expect(tickets).toHaveLength(3);
      expect(tickets.map((t) => t.price)).toEqual([22500, 15000, 15000]);
      tickets.forEach((t) => expect(typeof t.code).toBe('string'));
      expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
      expect(qrMock.rollbackTransaction).not.toHaveBeenCalled();
      expect(qrMock.release).toHaveBeenCalled();
    });

    it('marca los holds como CONFIRMED', async () => {
      arrangeConfirmation([buildHold('h1', SeatType.VIP)]);

      await service.confirmReservation(dto(['h1']));

      const savedHolds = qrMock.manager.save.mock.calls
        .filter(([entity]: [unknown]) => entity === SeatHold)
        .map(([, hold]: [unknown, any]) => hold);
      expect(savedHolds).toHaveLength(1);
      expect(savedHolds[0].status).toBe(SeatHoldStatus.CONFIRMED);
    });

    it('bloquea los holds sin relaciones (FOR UPDATE no admite LEFT JOIN nullable)', async () => {
      arrangeConfirmation([buildHold('h1', SeatType.NORMAL)]);

      await service.confirmReservation(dto(['h1']));

      const [lockCall, seatsCall] = qrMock.manager.find.mock.calls;
      expect(lockCall[1].lock).toEqual({ mode: 'pessimistic_write' });
      expect(lockCall[1].relations).toBeUndefined();
      expect(seatsCall[1].relations).toEqual({ seat: true });
      expect(seatsCall[1].lock).toBeUndefined();
    });

    it('lanza NotFoundException si el usuario no existe', async () => {
      qrMock.manager.findOneBy.mockResolvedValueOnce(null);

      await expect(service.confirmReservation(dto(['h1']))).rejects.toThrow(
        new NotFoundException('User not found'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qrMock.release).toHaveBeenCalledTimes(1);
    });

    it('lanza NotFoundException si la función no existe', async () => {
      qrMock.manager.findOneBy.mockResolvedValueOnce(USER).mockResolvedValueOnce(null);

      await expect(service.confirmReservation(dto(['h1']))).rejects.toThrow(
        new NotFoundException('Showtime not found'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qrMock.release).toHaveBeenCalledTimes(1);
    });

    it('lanza BadRequestException si los holds bloqueados no coinciden con los solicitados', async () => {
      qrMock.manager.findOneBy.mockResolvedValueOnce(USER).mockResolvedValueOnce(SHOWTIME);
      qrMock.manager.find.mockResolvedValueOnce([{ id: 'h1' }]);

      await expect(service.confirmReservation(dto(['h1', 'h2']))).rejects.toThrow(
        new BadRequestException('Some seat holds are invalid, expired or do not belong to the user'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('lanza BadRequestException si algún hold no está en estado ACTIVE', async () => {
      qrMock.manager.findOneBy.mockResolvedValueOnce(USER).mockResolvedValueOnce(SHOWTIME);
      const inactiveHold = {
        id: 'h1',
        status: SeatHoldStatus.CONFIRMED,
        expiresAt: futureDate(),
      };
      qrMock.manager.find.mockResolvedValueOnce([inactiveHold]);

      await expect(service.confirmReservation(dto(['h1']))).rejects.toThrow(
        new BadRequestException('SeatHold h1 is not ACTIVE'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('lanza BadRequestException si algún hold ya expiró', async () => {
      qrMock.manager.findOneBy.mockResolvedValueOnce(USER).mockResolvedValueOnce(SHOWTIME);
      const expiredHold = {
        id: 'h1',
        status: SeatHoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 1000),
      };
      qrMock.manager.find.mockResolvedValueOnce([expiredHold]);

      await expect(service.confirmReservation(dto(['h1']))).rejects.toThrow(
        new BadRequestException('SeatHold h1 has EXPIRED'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('hace rollback y lanza InternalServerErrorException si ocurre un fallo inesperado en BD', async () => {
      qrMock.manager.findOneBy.mockRejectedValueOnce(new Error('Fatal database connection error'));

      await expect(service.confirmReservation(dto(['h1']))).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qrMock.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelReservation', () => {
    const customerUser: AuthenticatedUser = {
      id: 'user-1',
      email: 'customer@test.com',
      roles: [ValidRoles.CUSTOMER],
    };

    const adminUser: AuthenticatedUser = {
      id: 'admin-1',
      email: 'admin@test.com',
      roles: [ValidRoles.ADMIN],
    };

    const otherCustomer: AuthenticatedUser = {
      id: 'other-user',
      email: 'other@test.com',
      roles: [ValidRoles.CUSTOMER],
    };

    const makeReservation = (overrides?: Partial<Reservation>): Reservation =>
      ({
        id: 'reservation-1',
        user: { id: customerUser.id } as any,
        showtime: { id: 'showtime-1', startTime: new Date(Date.now() + 24 * 60 * 60 * 1000) } as any,
        status: ReservationStatus.CONFIRMED,
        totalPrice: 15000,
        createdAt: new Date(),
        tickets: [],
        ...overrides,
      }) as Reservation;

    const makeTicket = (id: string, status = TicketStatus.VALID): Ticket =>
      ({
        id,
        code: `code-${id}`,
        status,
        price: 15000,
        seat: { id: `seat-${id}`, type: SeatType.NORMAL } as any,
        reservation: { id: 'reservation-1' } as any,
        usedAt: null,
        createdAt: new Date(),
      }) as Ticket;

    it('cancela exitosamente una reserva del propio usuario cliente', async () => {
      const reservation = makeReservation();
      const ticket = makeTicket('t1');
      const hold = { id: 'hold-1', status: SeatHoldStatus.CONFIRMED, seat: { id: 'seat-t1' } };

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);
      // find locked tickets, find populated tickets, find confirmed holds
      qrMock.manager.find
        .mockResolvedValueOnce([{ id: ticket.id }])
        .mockResolvedValueOnce([ticket])
        .mockResolvedValueOnce([hold]);

      repoMock.findOne.mockResolvedValueOnce({
        ...reservation,
        status: ReservationStatus.CANCELLED,
        tickets: [{ ...ticket, status: TicketStatus.CANCELLED }],
      });

      const result = await service.cancelReservation('reservation-1', customerUser);

      expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
      expect(qrMock.rollbackTransaction).not.toHaveBeenCalled();
      expect(qrMock.release).toHaveBeenCalledTimes(1);
      expect(qrMock.manager.remove).toHaveBeenCalledWith(SeatHold, [hold]);
      expect(result.status).toBe(ReservationStatus.CANCELLED);
    });

    it('permite a un ADMIN cancelar la reserva de otro usuario', async () => {
      const reservation = makeReservation();
      const ticket = makeTicket('t1');

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);
      qrMock.manager.find
        .mockResolvedValueOnce([{ id: ticket.id }])
        .mockResolvedValueOnce([ticket])
        .mockResolvedValueOnce([]);

      await service.cancelReservation('reservation-1', adminUser);

      expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('lanza ForbiddenException si otro cliente intenta cancelar la reserva', async () => {
      const reservation = makeReservation();

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);

      await expect(service.cancelReservation('reservation-1', otherCustomer)).rejects.toThrow(
        ForbiddenException,
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalled();
      expect(qrMock.commitTransaction).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si la reserva no existe', async () => {
      qrMock.manager.findOne.mockResolvedValueOnce(null);

      await expect(service.cancelReservation('non-existent-id', customerUser)).rejects.toThrow(
        NotFoundException,
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    });

    it('lanza BadRequestException si la reserva ya está cancelada', async () => {
      const reservation = makeReservation({ status: ReservationStatus.CANCELLED });

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);

      await expect(service.cancelReservation('reservation-1', customerUser)).rejects.toThrow(
        new BadRequestException('Reservation is already cancelled'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    });

    it('lanza BadRequestException si la reserva no está CONFIRMED', async () => {
      const reservation = makeReservation({ status: ReservationStatus.PENDING });

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);

      await expect(service.cancelReservation('reservation-1', customerUser)).rejects.toThrow(
        new BadRequestException('Only confirmed reservations can be cancelled'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    });

    it('lanza BadRequestException si la función ya inició', async () => {
      const pastShowtime = { id: 'showtime-1', startTime: new Date(Date.now() - 1000) };
      const reservation = makeReservation({ showtime: pastShowtime as any });

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);

      await expect(service.cancelReservation('reservation-1', customerUser)).rejects.toThrow(
        new BadRequestException('Cannot cancel reservation: showtime has already started'),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    });

    it('lanza BadRequestException si uno de los tickets ya fue utilizado (USED)', async () => {
      const reservation = makeReservation();
      const usedTicket = makeTicket('t1', TicketStatus.USED);

      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);
      qrMock.manager.find
        .mockResolvedValueOnce([{ id: usedTicket.id }])
        .mockResolvedValueOnce([usedTicket]);

      await expect(service.cancelReservation('reservation-1', customerUser)).rejects.toThrow(
        new BadRequestException(
          'Cannot cancel reservation: one or more tickets have already been used',
        ),
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalled();
      expect(qrMock.manager.remove).not.toHaveBeenCalled();
    });

    it('bloquea la reserva de forma aislada sin outer joins', async () => {
      const reservation = makeReservation();
      qrMock.manager.findOne.mockResolvedValueOnce({ id: reservation.id });
      qrMock.manager.findOneOrFail.mockResolvedValueOnce(reservation);
      qrMock.manager.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.cancelReservation('reservation-1', customerUser);

      const firstFindCall = qrMock.manager.findOne.mock.calls[0];
      expect(firstFindCall[1].lock).toEqual({ mode: 'pessimistic_write' });
      expect(firstFindCall[1].relations).toBeUndefined();
    });

    it('hace rollback y lanza InternalServerErrorException ante un fallo inesperado en BD', async () => {
      qrMock.manager.findOne.mockRejectedValueOnce(new Error('Database lock deadlock'));

      await expect(service.cancelReservation('reservation-1', customerUser)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qrMock.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('findMyReservations', () => {
    const userId = 'user-test-id';

    const makeReservationWithDate = (
      id: string,
      startTime: Date,
      status = ReservationStatus.CONFIRMED,
    ): Reservation =>
      ({
        id,
        user: { id: userId } as any,
        showtime: {
          id: `showtime-${id}`,
          startTime,
          movie: { id: 'm1', title: 'Inception' },
          room: { id: 'r1', name: 'Sala 1' },
        } as any,
        tickets: [
          {
            id: `ticket-${id}`,
            code: `code-${id}`,
            status: TicketStatus.VALID,
            seat: { id: 's1', row: 1, column: 1, type: SeatType.NORMAL },
          },
        ] as any,
        status,
        totalPrice: 15000,
        createdAt: new Date(),
      }) as Reservation;

    it('retorna summary con contadores en cero y listas vacías si el usuario no tiene reservas', async () => {
      repoMock.find.mockResolvedValueOnce([]);

      const result = (await service.findMyReservations(userId)) as any;

      expect(repoMock.find).toHaveBeenCalledWith({
        where: { user: { id: userId } },
        relations: {
          showtime: { movie: true, room: true },
          tickets: { seat: true },
        },
        order: { createdAt: 'DESC' },
      });
      expect(result.summary).toEqual({
        totalReservations: 0,
        upcomingCount: 0,
        pastCount: 0,
      });
      expect(result.upcoming).toEqual([]);
      expect(result.past).toEqual([]);
    });

    it('clasifica correctamente reservas en upcoming y past con ordenamiento adecuado', async () => {
      const futureNear = new Date(Date.now() + 2 * 60 * 60 * 1000); // en 2 horas
      const futureFar = new Date(Date.now() + 24 * 60 * 60 * 1000); // en 24 horas
      const pastRecent = new Date(Date.now() - 2 * 60 * 60 * 1000); // hace 2 horas
      const pastOld = new Date(Date.now() - 24 * 60 * 60 * 1000); // hace 24 horas

      const resFutureFar = makeReservationWithDate('r-far', futureFar);
      const resFutureNear = makeReservationWithDate('r-near', futureNear);
      const resPastRecent = makeReservationWithDate('r-recent', pastRecent);
      const resPastOld = makeReservationWithDate('r-old', pastOld);

      repoMock.find.mockResolvedValueOnce([
        resFutureFar,
        resPastRecent,
        resFutureNear,
        resPastOld,
      ]);

      const result = (await service.findMyReservations(userId)) as any;

      expect(result.summary).toEqual({
        totalReservations: 4,
        upcomingCount: 2,
        pastCount: 2,
      });

      // upcoming ordenado ASC (más próxima primero)
      expect(result.upcoming.map((r: any) => r.id)).toEqual(['r-near', 'r-far']);

      // past ordenado DESC (más reciente primero)
      expect(result.past.map((r: any) => r.id)).toEqual(['r-recent', 'r-old']);
    });

    it('retorna únicamente la lista de próximas cuando timeframe = UPCOMING', async () => {
      const future = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const past = new Date(Date.now() - 5 * 60 * 60 * 1000);

      const resFuture = makeReservationWithDate('r-fut', future);
      const resPast = makeReservationWithDate('r-past', past);

      repoMock.find.mockResolvedValueOnce([resFuture, resPast]);

      const result = await service.findMyReservations(userId, {
        timeframe: ReservationTimeframe.UPCOMING,
      });

      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).map((r) => r.id)).toEqual(['r-fut']);
    });

    it('retorna únicamente la lista de pasadas cuando timeframe = PAST', async () => {
      const future = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const past = new Date(Date.now() - 5 * 60 * 60 * 1000);

      const resFuture = makeReservationWithDate('r-fut', future);
      const resPast = makeReservationWithDate('r-past', past);

      repoMock.find.mockResolvedValueOnce([resFuture, resPast]);

      const result = await service.findMyReservations(userId, {
        timeframe: ReservationTimeframe.PAST,
      });

      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).map((r) => r.id)).toEqual(['r-past']);
    });
  });

  describe('findAll', () => {
    it('retorna la lista de todas las reservas con sus relaciones', async () => {
      const mockList = [{ id: 'res-1' }, { id: 'res-2' }];
      repoMock.find.mockResolvedValueOnce(mockList);

      const result = await service.findAll();

      expect(repoMock.find).toHaveBeenCalledWith({
        relations: { user: true, showtime: true },
      });
      expect(result).toBe(mockList);
    });
  });

  describe('findById', () => {
    it('retorna la reserva solicitada cuando existe con relaciones', async () => {
      const mockRes = { id: 'res-1', user: { id: 'u1' } };
      repoMock.findOne.mockResolvedValueOnce(mockRes);

      const result = await service.findById('res-1');

      expect(repoMock.findOne).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        relations: { user: true, showtime: true, tickets: { seat: true } },
      });
      expect(result).toBe(mockRes);
    });

    it('lanza NotFoundException cuando la reserva no existe', async () => {
      repoMock.findOne.mockResolvedValueOnce(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

