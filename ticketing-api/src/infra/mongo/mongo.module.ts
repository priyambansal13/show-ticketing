import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Env } from '../../config/env.js';
import { applyMongooseSecurityDefaults } from './mongoose-defaults.js';

applyMongooseSecurityDefaults();

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGO_URL', { infer: true }),
        // Indexes are declared in the schemas; build them automatically outside production.
        autoIndex: config.get('NODE_ENV', { infer: true }) !== 'production',
        serverSelectionTimeoutMS: 5000,
      }),
    }),
  ],
})
export class MongoModule {}
