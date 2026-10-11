import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Reservation } from '../../reservations/entities/reservation.entity';
import { Seat } from '../../rooms/entities/seat.entity';

export enum TicketStatus {
  VALID = 'VALID',
  USED = 'USED',
  CANCELLED = 'CANCELLED',
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, nullable: false })
  code: string;

  @ManyToOne(() => Reservation, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation;

  @ManyToOne(() => Seat, { nullable: false })
  @JoinColumn({ name: 'seat_id' })
  seat: Seat;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.VALID })
  status: TicketStatus;

  /**
   * Precio unitario cobrado por esta boleta (precio base de la función × multiplicador del tipo de asiento).
   * Nullable para no afectar las boletas emitidas antes de los precios diferenciados (RF-03 / RF-08).
   */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  price: number | null;

  /** Set by the counter on check-in; reported back if someone tries to reuse the ticket. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
