import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { RoleName } from '../../common/enums/roles.enum';
import { User } from './user.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('increment', { type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 40, unique: true })
  name: RoleName;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => User, (user) => user.role)
  users: User[];
}
