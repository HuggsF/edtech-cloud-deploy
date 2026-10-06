import { createLogger } from '@infrastructure/logging/logger';

describe('Logger', () => {
  it('creates a Pino logger instance with custom name and level', () => {
    const logger = createLogger({
      level: 'debug',
      pretty: false,
      name: 'test-logger',
    });

    expect(logger).toBeDefined();
    expect(logger.level).toBe('debug');
  });

  it('creates a logger with default name when none is provided', () => {
    const logger = createLogger({
      level: 'info',
      pretty: false,
    });

    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });

  it('configures pretty transport when pretty option is true', () => {
    const logger = createLogger({
      level: 'warn',
      pretty: true,
      name: 'pretty-test',
    });

    expect(logger).toBeDefined();
    expect(logger.level).toBe('warn');
  });
});
