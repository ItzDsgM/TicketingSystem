import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Showtime } from '../../showtimes/entities/showtime.entity';
import { Ticket } from '../../tickets/entities/ticket.entity';

export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Showtime, { nullable: false })
  @JoinColumn({ name: 'showtime_id' })
  showtime: Showtime;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.PENDING })
  status: ReservationStatus;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: false })
  totalPrice: number;

  @OneToMany(() => Ticket, (ticket) => ticket.reservation)
  tickets: Ticket[];

  @CreateDateColumn()
  createdAt: Date;
}
