import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { seedReferenceData } from './reference-data.seed';
import { seedAdminUser } from './admin-user.seed';

async function main() {
  await AppDataSource.initialize();
  await seedReferenceData(AppDataSource);
  await seedAdminUser(AppDataSource);
  await AppDataSource.destroy();
}

main()
  .then(() => {
    console.log('Seeding complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
