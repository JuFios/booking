import { plainToInstance } from 'class-transformer';
import { LOG_LEVELS, type LogLevel } from '../common/logging/logger.config';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must start with postgresql://',
  })
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  // Token lifetimes in seconds
  @IsInt()
  @Min(1)
  JWT_ACCESS_TTL: number = 900;

  @IsInt()
  @Min(1)
  JWT_REFRESH_TTL: number = 604800;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(env, { skipMissingProperties: false });
  const messages = errors.flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

  // With one secret for both, a refresh token would also pass as an access token
  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    messages.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }

  if (messages.length > 0) {
    throw new Error(
      `Invalid environment variables:\n  - ${messages.join('\n  - ')}`,
    );
  }

  return env;
}
