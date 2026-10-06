import { SystemClock } from '@infrastructure/system/system-clock';
import { UuidV7IdGenerator } from '@infrastructure/system/uuid-v7-id-generator';

describe('System Infrastructure Adapters', () => {
  describe('SystemClock', () => {
    it('returns a current Date instance', () => {
      const clock = new SystemClock();
      const before = Date.now();
      const now = clock.now();
      const after = Date.now();

      expect(now).toBeInstanceOf(Date);
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('UuidV7IdGenerator', () => {
    it('generates a valid UUID v7 format string', () => {
      const generator = new UuidV7IdGenerator();
      const id1 = generator.generate();
      const id2 = generator.generate();

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id1).toMatch(uuidRegex);
      expect(id2).toMatch(uuidRegex);
      expect(id1).not.toBe(id2);
    });
  });
});
