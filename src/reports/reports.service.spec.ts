import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

import { ReportsService } from './reports.service';
import { Showtime } from '../showtimes/entities/showtime.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { SeatType } from '../rooms/entities/seat.entity';

describe('ReportsService', () => {
  let service: ReportsService;
  let showtimeRepo: any;
  let ticketRepo: any;
  let configService: any;

  let showtimeQueryBuilder: any;
  let ticketQueryBuilder: any;

  beforeEach(async () => {
    showtimeQueryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    ticketQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    showtimeRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => showtimeQueryBuilder),
    };

    ticketRepo = {
      createQueryBuilder: jest.fn(() => ticketQueryBuilder),
    };

    configService = {
      get: jest.fn().mockReturnValue('1.5'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: getRepositoryToken(Showtime),
          useValue: showtimeRepo,
        },
        {
          provide: getRepositoryToken(Ticket),
          useValue: ticketRepo,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getShowtimeReport', () => {
    const mockShowtime: any = {
      id: 'st-1',
      startTime: new Date('2026-10-15T20:00:00Z'),
      price: 10000,
      movie: {
        id: 'mov-1',
        title: 'Interstellar',
        durationMinutes: 169,
      },
      room: {
        id: 'room-1',
        name: 'Sala 1',
        capacity: 100,
      },
    };

    it('should throw NotFoundException if showtime does not exist', async () => {
      showtimeRepo.findOne.mockResolvedValue(null);

      await expect(service.getShowtimeReport('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return report with 0 sales if no tickets have been sold', async () => {
      showtimeRepo.findOne.mockResolvedValue(mockShowtime);
      ticketQueryBuilder.getRawMany.mockResolvedValue([]);

      const report = await service.getShowtimeReport('st-1');

      expect(report.showtimeId).toBe('st-1');
      expect(report.movie.title).toBe('Interstellar');
      expect(report.room.name).toBe('Sala 1');
      expect(report.totalCapacity).toBe(100);
      expect(report.ticketsSold).toBe(0);
      expect(report.availableSeats).toBe(100);
      expect(report.occupancyPercentage).toBe(0);
      expect(report.totalRevenue).toBe(0);
      expect(report.breakdownBySeatType).toEqual({
        normal: { count: 0, revenue: 0 },
        vip: { count: 0, revenue: 0 },
      });
    });

    it('should calculate metrics correctly with explicit ticket prices', async () => {
      showtimeRepo.findOne.mockResolvedValue(mockShowtime);
      ticketQueryBuilder.getRawMany.mockResolvedValue([
        { ticketId: 't-1', price: 10000, seatType: SeatType.NORMAL },
        { ticketId: 't-2', price: 10000, seatType: SeatType.NORMAL },
        { ticketId: 't-3', price: 15000, seatType: SeatType.VIP },
      ]);

      const report = await service.getShowtimeReport('st-1');

      expect(report.ticketsSold).toBe(3);
      expect(report.availableSeats).toBe(97);
      expect(report.occupancyPercentage).toBe(3); // (3 / 100) * 100 = 3%
      expect(report.totalRevenue).toBe(35000);
      expect(report.breakdownBySeatType.normal).toEqual({
        count: 2,
        revenue: 20000,
      });
      expect(report.breakdownBySeatType.vip).toEqual({
        count: 1,
        revenue: 15000,
      });
    });

    it('should use fallback price calculation when ticket.price is null', async () => {
      showtimeRepo.findOne.mockResolvedValue(mockShowtime);
      // Showtime base price is 10000. VIP multiplier is 1.5 -> 15000
      ticketQueryBuilder.getRawMany.mockResolvedValue([
        { ticketId: 't-1', price: null, seatType: SeatType.NORMAL },
        { ticketId: 't-2', price: null, seatType: SeatType.VIP },
      ]);

      const report = await service.getShowtimeReport('st-1');

      expect(report.ticketsSold).toBe(2);
      expect(report.totalRevenue).toBe(25000);
      expect(report.breakdownBySeatType.normal).toEqual({
        count: 1,
        revenue: 10000,
      });
      expect(report.breakdownBySeatType.vip).toEqual({
        count: 1,
        revenue: 15000,
      });
    });

    it('should handle room with capacity 0 gracefully without division by zero', async () => {
      const zeroCapacityShowtime: any = {
        ...mockShowtime,
        room: { ...mockShowtime.room, capacity: 0 },
      };
      showtimeRepo.findOne.mockResolvedValue(zeroCapacityShowtime);
      ticketQueryBuilder.getRawMany.mockResolvedValue([]);

      const report = await service.getShowtimeReport('st-1');

      expect(report.totalCapacity).toBe(0);
      expect(report.occupancyPercentage).toBe(0);
      expect(report.availableSeats).toBe(0);
    });
  });

  describe('getSummaryReport', () => {
    const mockShowtimes: any[] = [
      {
        id: 'st-1',
        startTime: new Date('2026-10-15T18:00:00Z'),
        price: 10000,
        movie: { id: 'mov-1', title: 'Inception', durationMinutes: 148 },
        room: { id: 'room-1', name: 'Sala 1', capacity: 50 },
      },
      {
        id: 'st-2',
        startTime: new Date('2026-10-15T21:00:00Z'),
        price: 12000,
        movie: { id: 'mov-2', title: 'Avatar', durationMinutes: 160 },
        room: { id: 'room-2', name: 'Sala 2', capacity: 50 },
      },
    ];

    it('should return empty summary with zeros if no showtimes exist', async () => {
      showtimeQueryBuilder.getMany.mockResolvedValue([]);

      const summary = await service.getSummaryReport();

      expect(summary.totalShowtimes).toBe(0);
      expect(summary.totalCapacity).toBe(0);
      expect(summary.totalTicketsSold).toBe(0);
      expect(summary.totalAvailableSeats).toBe(0);
      expect(summary.overallOccupancyPercentage).toBe(0);
      expect(summary.totalRevenue).toBe(0);
      expect(summary.breakdownBySeatType).toEqual({
        normal: { count: 0, revenue: 0 },
        vip: { count: 0, revenue: 0 },
      });
      expect(summary.movies).toEqual([]);
    });

    it('should apply filters (movieId, roomId, startDate, endDate)', async () => {
      showtimeQueryBuilder.getMany.mockResolvedValue([]);

      await service.getSummaryReport({
        movieId: 'mov-1',
        roomId: 'room-1',
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-31T23:59:59Z',
      });

      expect(showtimeQueryBuilder.andWhere).toHaveBeenCalledWith(
        'movie.id = :movieId',
        { movieId: 'mov-1' },
      );
      expect(showtimeQueryBuilder.andWhere).toHaveBeenCalledWith(
        'room.id = :roomId',
        { roomId: 'room-1' },
      );
      expect(showtimeQueryBuilder.andWhere).toHaveBeenCalledWith(
        'showtime.startTime >= :startDate',
        { startDate: new Date('2026-10-01T00:00:00Z') },
      );
      expect(showtimeQueryBuilder.andWhere).toHaveBeenCalledWith(
        'showtime.startTime <= :endDate',
        { endDate: new Date('2026-10-31T23:59:59Z') },
      );
    });

    it('should aggregate global metrics and per-movie metrics correctly', async () => {
      showtimeQueryBuilder.getMany.mockResolvedValue(mockShowtimes);
      ticketQueryBuilder.getRawMany.mockResolvedValue([
        // st-1 (mov-1): 2 normal tickets @ 10000 = 20000
        {
          showtimeId: 'st-1',
          ticketId: 't-1',
          price: 10000,
          seatType: SeatType.NORMAL,
          basePrice: 10000,
        },
        {
          showtimeId: 'st-1',
          ticketId: 't-2',
          price: 10000,
          seatType: SeatType.NORMAL,
          basePrice: 10000,
        },
        // st-2 (mov-2): 1 normal @ 12000 + 1 VIP @ 18000 = 30000
        {
          showtimeId: 'st-2',
          ticketId: 't-3',
          price: 12000,
          seatType: SeatType.NORMAL,
          basePrice: 12000,
        },
        {
          showtimeId: 'st-2',
          ticketId: 't-4',
          price: 18000,
          seatType: SeatType.VIP,
          basePrice: 12000,
        },
      ]);

      const summary = await service.getSummaryReport();

      expect(summary.totalShowtimes).toBe(2);
      expect(summary.totalCapacity).toBe(100); // 50 + 50
      expect(summary.totalTicketsSold).toBe(4);
      expect(summary.totalAvailableSeats).toBe(96);
      expect(summary.overallOccupancyPercentage).toBe(4); // 4 / 100 = 4%
      expect(summary.totalRevenue).toBe(50000); // 20000 + 30000
      expect(summary.breakdownBySeatType.normal).toEqual({
        count: 3,
        revenue: 32000,
      });
      expect(summary.breakdownBySeatType.vip).toEqual({
        count: 1,
        revenue: 18000,
      });

      // Movies breakdown
      expect(summary.movies).toHaveLength(2);

      const mov1 = summary.movies.find((m) => m.movieId === 'mov-1');
      expect(mov1).toBeDefined();
      expect(mov1!.title).toBe('Inception');
      expect(mov1!.showtimesCount).toBe(1);
      expect(mov1!.totalCapacity).toBe(50);
      expect(mov1!.ticketsSold).toBe(2);
      expect(mov1!.totalRevenue).toBe(20000);
      expect(mov1!.occupancyPercentage).toBe(4); // 2 / 50 = 4%

      const mov2 = summary.movies.find((m) => m.movieId === 'mov-2');
      expect(mov2).toBeDefined();
      expect(mov2!.title).toBe('Avatar');
      expect(mov2!.showtimesCount).toBe(1);
      expect(mov2!.totalCapacity).toBe(50);
      expect(mov2!.ticketsSold).toBe(2);
      expect(mov2!.totalRevenue).toBe(30000);
      expect(mov2!.occupancyPercentage).toBe(4);
    });
  });
});
