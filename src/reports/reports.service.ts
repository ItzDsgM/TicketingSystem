import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";

import { Showtime } from "../showtimes/entities/showtime.entity";
import { Ticket, TicketStatus } from "../tickets/entities/ticket.entity";
import { ReservationStatus } from "../reservations/entities/reservation.entity";
import { SeatType } from "../rooms/entities/seat.entity";

import { FilterSummaryReportDto } from "./dtos/filter-summary-report.dto";
import { ShowtimeReportResponseDto } from "./dtos/showtime-report-response.dto";
import {
  MovieSummaryDto,
  SummaryReportResponseDto,
} from "./dtos/summary-report-response.dto";

@Injectable()
export class ReportsService {
  private readonly VIP_PRICE_MULTIPLIER: number;

  constructor(
    @InjectRepository(Showtime)
    private readonly showtimeRepository: Repository<Showtime>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly configService: ConfigService,
  ) {
    const multiplierRaw = this.configService?.get<string>(
      "VIP_PRICE_MULTIPLIER",
    );
    const parsed = multiplierRaw ? parseFloat(multiplierRaw) : NaN;
    this.VIP_PRICE_MULTIPLIER = !isNaN(parsed) && parsed > 0 ? parsed : 1.5;
  }

  async getShowtimeReport(
    showtimeId: string,
  ): Promise<ShowtimeReportResponseDto> {
    const showtime = await this.showtimeRepository.findOne({
      where: { id: showtimeId },
      relations: {
        movie: true,
        room: true,
      },
    });

    if (!showtime) {
      throw new NotFoundException(`Showtime with ID ${showtimeId} not found`);
    }

    const rawTickets = await this.ticketRepository
      .createQueryBuilder("ticket")
      .innerJoin("ticket.reservation", "reservation")
      .innerJoin("reservation.showtime", "showtime")
      .innerJoin("ticket.seat", "seat")
      .where("showtime.id = :showtimeId", { showtimeId })
      .andWhere("reservation.status = :reservationStatus", {
        reservationStatus: ReservationStatus.CONFIRMED,
      })
      .andWhere("ticket.status IN (:...ticketStatuses)", {
        ticketStatuses: [TicketStatus.VALID, TicketStatus.USED],
      })
      .select([
        'ticket.id AS "ticketId"',
        'ticket.price AS "price"',
        'seat.type AS "seatType"',
      ])
      .getRawMany();

    let normalCount = 0;
    let vipCount = 0;
    let normalRevenue = 0;
    let vipRevenue = 0;

    const basePrice = Number(showtime.price);

    for (const row of rawTickets) {
      const isVip = row.seatType === SeatType.VIP;
      const fallbackPrice = isVip
        ? Number((basePrice * this.VIP_PRICE_MULTIPLIER).toFixed(2))
        : basePrice;
      const price =
        row.price !== null && row.price !== undefined
          ? Number(Number(row.price).toFixed(2))
          : fallbackPrice;

      if (isVip) {
        vipCount++;
        vipRevenue += price;
      } else {
        normalCount++;
        normalRevenue += price;
      }
    }

    const ticketsSold = normalCount + vipCount;
    const totalRevenue = Number((normalRevenue + vipRevenue).toFixed(2));
    const totalCapacity = showtime.room ? showtime.room.capacity : 0;
    const availableSeats = Math.max(0, totalCapacity - ticketsSold);
    const occupancyPercentage =
      totalCapacity > 0
        ? Number(((ticketsSold / totalCapacity) * 100).toFixed(2))
        : 0;

    return {
      showtimeId: showtime.id,
      movie: {
        id: showtime.movie.id,
        title: showtime.movie.title,
        durationMinutes: showtime.movie.durationMinutes,
      },
      room: {
        id: showtime.room.id,
        name: showtime.room.name,
        capacity: showtime.room.capacity,
      },
      startTime: showtime.startTime,
      basePrice,
      totalCapacity,
      ticketsSold,
      availableSeats,
      occupancyPercentage,
      totalRevenue,
      breakdownBySeatType: {
        normal: {
          count: normalCount,
          revenue: Number(normalRevenue.toFixed(2)),
        },
        vip: {
          count: vipCount,
          revenue: Number(vipRevenue.toFixed(2)),
        },
      },
    };
  }

  async getSummaryReport(
    filterDto?: FilterSummaryReportDto,
  ): Promise<SummaryReportResponseDto> {
    const qb = this.showtimeRepository
      .createQueryBuilder("showtime")
      .innerJoinAndSelect("showtime.movie", "movie")
      .innerJoinAndSelect("showtime.room", "room");

    if (filterDto?.movieId) {
      qb.andWhere("movie.id = :movieId", { movieId: filterDto.movieId });
    }

    if (filterDto?.roomId) {
      qb.andWhere("room.id = :roomId", { roomId: filterDto.roomId });
    }

    if (filterDto?.startDate) {
      qb.andWhere("showtime.startTime >= :startDate", {
        startDate: new Date(filterDto.startDate),
      });
    }

    if (filterDto?.endDate) {
      qb.andWhere("showtime.startTime <= :endDate", {
        endDate: new Date(filterDto.endDate),
      });
    }

    qb.orderBy("showtime.startTime", "DESC");
    const showtimes = await qb.getMany();

    if (showtimes.length === 0) {
      return {
        totalShowtimes: 0,
        totalCapacity: 0,
        totalTicketsSold: 0,
        totalAvailableSeats: 0,
        overallOccupancyPercentage: 0,
        totalRevenue: 0,
        breakdownBySeatType: {
          normal: { count: 0, revenue: 0 },
          vip: { count: 0, revenue: 0 },
        },
        movies: [],
      };
    }

    const showtimeIds = showtimes.map((s) => s.id);

    const rawTickets = await this.ticketRepository
      .createQueryBuilder("ticket")
      .innerJoin("ticket.reservation", "reservation")
      .innerJoin("reservation.showtime", "showtime")
      .innerJoin("ticket.seat", "seat")
      .where("showtime.id IN (:...showtimeIds)", { showtimeIds })
      .andWhere("reservation.status = :reservationStatus", {
        reservationStatus: ReservationStatus.CONFIRMED,
      })
      .andWhere("ticket.status IN (:...ticketStatuses)", {
        ticketStatuses: [TicketStatus.VALID, TicketStatus.USED],
      })
      .select([
        'showtime.id AS "showtimeId"',
        'ticket.id AS "ticketId"',
        'ticket.price AS "price"',
        'seat.type AS "seatType"',
        'showtime.price AS "basePrice"',
      ])
      .getRawMany();

    let globalNormalCount = 0;
    let globalVipCount = 0;
    let globalNormalRevenue = 0;
    let globalVipRevenue = 0;

    const ticketsByShowtime = new Map<
      string,
      Array<{ price: number; seatType: SeatType }>
    >();
    for (const stId of showtimeIds) {
      ticketsByShowtime.set(stId, []);
    }

    for (const row of rawTickets) {
      const isVip = row.seatType === SeatType.VIP;
      const basePrice = Number(row.basePrice);
      const fallbackPrice = isVip
        ? Number((basePrice * this.VIP_PRICE_MULTIPLIER).toFixed(2))
        : basePrice;
      const price =
        row.price !== null && row.price !== undefined
          ? Number(Number(row.price).toFixed(2))
          : fallbackPrice;

      if (isVip) {
        globalVipCount++;
        globalVipRevenue += price;
      } else {
        globalNormalCount++;
        globalNormalRevenue += price;
      }

      const list = ticketsByShowtime.get(row.showtimeId);
      if (list) {
        list.push({ price, seatType: row.seatType });
      }
    }

    const totalShowtimes = showtimes.length;
    const totalCapacity = showtimes.reduce(
      (acc, st) => acc + (st.room ? st.room.capacity : 0),
      0,
    );
    const totalTicketsSold = globalNormalCount + globalVipCount;
    const totalAvailableSeats = Math.max(0, totalCapacity - totalTicketsSold);
    const totalRevenue = Number(
      (globalNormalRevenue + globalVipRevenue).toFixed(2),
    );
    const overallOccupancyPercentage =
      totalCapacity > 0
        ? Number(((totalTicketsSold / totalCapacity) * 100).toFixed(2))
        : 0;

    const movieAggMap = new Map<
      string,
      {
        movieId: string;
        title: string;
        showtimesCount: number;
        totalCapacity: number;
        ticketsSold: number;
        revenue: number;
      }
    >();

    for (const st of showtimes) {
      const movieId = st.movie.id;
      let movieStat = movieAggMap.get(movieId);
      if (!movieStat) {
        movieStat = {
          movieId,
          title: st.movie.title,
          showtimesCount: 0,
          totalCapacity: 0,
          ticketsSold: 0,
          revenue: 0,
        };
        movieAggMap.set(movieId, movieStat);
      }

      movieStat.showtimesCount++;
      movieStat.totalCapacity += st.room ? st.room.capacity : 0;

      const showtimeTickets = ticketsByShowtime.get(st.id) || [];
      movieStat.ticketsSold += showtimeTickets.length;
      movieStat.revenue += showtimeTickets.reduce((sum, t) => sum + t.price, 0);
    }

    const movies: MovieSummaryDto[] = Array.from(movieAggMap.values()).map(
      (m) => ({
        movieId: m.movieId,
        title: m.title,
        showtimesCount: m.showtimesCount,
        totalCapacity: m.totalCapacity,
        ticketsSold: m.ticketsSold,
        totalRevenue: Number(m.revenue.toFixed(2)),
        occupancyPercentage:
          m.totalCapacity > 0
            ? Number(((m.ticketsSold / m.totalCapacity) * 100).toFixed(2))
            : 0,
      }),
    );

    return {
      totalShowtimes,
      totalCapacity,
      totalTicketsSold,
      totalAvailableSeats,
      overallOccupancyPercentage,
      totalRevenue,
      breakdownBySeatType: {
        normal: {
          count: globalNormalCount,
          revenue: Number(globalNormalRevenue.toFixed(2)),
        },
        vip: {
          count: globalVipCount,
          revenue: Number(globalVipRevenue.toFixed(2)),
        },
      },
      movies,
    };
  }
}
