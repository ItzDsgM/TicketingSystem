import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ValidRoles } from '../common/enums/valid-roles.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ReservationStatus } from './entities/reservation.entity';
import { ReservationTimeframe } from './dtos/filter-my-reservations.dto';

describe('ReservationsController', () => {
  let controller: ReservationsController;
  let service: any;

  const mockService = {
    confirmReservation: jest.fn(),
    findAll: jest.fn(),
    findMyReservations: jest.fn(),
    findById: jest.fn(),
    cancelReservation: jest.fn(),
  };

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

  const otherUser: AuthenticatedUser = {
    id: 'other-user',
    email: 'other@test.com',
    roles: [ValidRoles.CUSTOMER],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [
        {
          provide: ReservationsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ReservationsController>(ReservationsController);
    service = module.get(ReservationsService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('confirm', () => {
    it('debe delegar a reservationsService.confirmReservation con userId inyectado', async () => {
      const dto = { showtimeId: 'st-1', seatHoldIds: ['h1'] };
      const expected = { id: 'res-1', status: ReservationStatus.CONFIRMED };
      mockService.confirmReservation.mockResolvedValueOnce(expected);

      const result = await controller.confirm(dto as any, 'user-1');

      expect(service.confirmReservation).toHaveBeenCalledWith({ ...dto, userId: 'user-1' });
      expect(result).toBe(expected);
    });
  });

  describe('findAll', () => {
    it('debe delegar a reservationsService.findAll', async () => {
      const expected = [{ id: 'res-1' }];
      mockService.findAll.mockResolvedValueOnce(expected);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toBe(expected);
    });
  });

  describe('findMyReservations', () => {
    it('debe delegar a reservationsService.findMyReservations', async () => {
      const filterDto = { timeframe: ReservationTimeframe.UPCOMING };
      const expected = [{ id: 'res-1' }];
      mockService.findMyReservations.mockResolvedValueOnce(expected);

      const result = await controller.findMyReservations('user-1', filterDto);

      expect(service.findMyReservations).toHaveBeenCalledWith('user-1', filterDto);
      expect(result).toBe(expected);
    });
  });

  describe('findOne', () => {
    const reservation = {
      id: 'res-1',
      user: { id: customerUser.id },
      status: ReservationStatus.CONFIRMED,
    };

    it('permite al propio usuario ver su reserva', async () => {
      mockService.findById.mockResolvedValueOnce(reservation);

      const result = await controller.findOne('res-1', customerUser);

      expect(service.findById).toHaveBeenCalledWith('res-1');
      expect(result).toBe(reservation);
    });

    it('permite a un ADMIN ver la reserva de cualquier usuario', async () => {
      mockService.findById.mockResolvedValueOnce(reservation);

      const result = await controller.findOne('res-1', adminUser);

      expect(service.findById).toHaveBeenCalledWith('res-1');
      expect(result).toBe(reservation);
    });

    it('lanza ForbiddenException si otro usuario intenta ver la reserva', async () => {
      mockService.findById.mockResolvedValueOnce(reservation);

      await expect(controller.findOne('res-1', otherUser)).rejects.toThrow(
        new ForbiddenException('You can only see your own reservations'),
      );
    });
  });

  describe('cancel', () => {
    it('debe delegar a reservationsService.cancelReservation', async () => {
      const expected = { id: 'res-1', status: ReservationStatus.CANCELLED };
      mockService.cancelReservation.mockResolvedValueOnce(expected);

      const result = await controller.cancel('res-1', customerUser);

      expect(service.cancelReservation).toHaveBeenCalledWith('res-1', customerUser);
      expect(result).toBe(expected);
    });
  });
});
