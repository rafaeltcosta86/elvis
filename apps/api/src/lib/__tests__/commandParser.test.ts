import { parseCommand } from '../commandParser';

describe('parseCommand', () => {
  describe('/hoje', () => {
    it('returns TODAY intent for /hoje', () => {
      expect(parseCommand('/hoje')).toEqual({ intent: 'TODAY' });
    });

    it('returns TODAY intent for /HOJE (case-insensitive)', () => {
      expect(parseCommand('/HOJE')).toEqual({ intent: 'TODAY' });
    });
  });

  describe('/done', () => {
    it('returns DONE intent with taskId for /done abc-123', () => {
      expect(parseCommand('/done abc-123')).toEqual({
        intent: 'DONE',
        args: { taskId: 'abc-123' },
      });
    });
  });

  describe('/adiar', () => {
    it('returns POSTPONE intent with taskId and to for /adiar abc-123 amanha', () => {
      expect(parseCommand('/adiar abc-123 amanha')).toEqual({
        intent: 'POSTPONE',
        args: { taskId: 'abc-123', to: 'amanha' },
      });
    });
  });

  describe('/semana', () => {
    it('returns WEEK intent for /semana', () => {
      expect(parseCommand('/semana')).toEqual({ intent: 'WEEK' });
    });
  });

  describe('/email', () => {
    it('returns EMAIL intent for /email', () => {
      expect(parseCommand('/email')).toEqual({ intent: 'EMAIL' });
    });
  });

  describe('/confirmar', () => {
    it('returns CONFIRM intent with communication_id', () => {
      expect(parseCommand('/confirmar abc-123')).toEqual({
        intent: 'CONFIRM',
        args: { communication_id: 'abc-123' },
      });
    });

    it('handles UUID communication_id', () => {
      expect(parseCommand('/confirmar 550e8400-e29b-41d4-a716-446655440000')).toEqual({
        intent: 'CONFIRM',
        args: { communication_id: '550e8400-e29b-41d4-a716-446655440000' },
      });
    });
  });

  describe('/cancelar', () => {
    it('returns CANCEL intent with communication_id', () => {
      expect(parseCommand('/cancelar abc-123')).toEqual({
        intent: 'CANCEL',
        args: { communication_id: 'abc-123' },
      });
    });
  });

  describe('CREATE_TASK', () => {
    it('returns CREATE_TASK intent with rawText for plain text', () => {
      expect(parseCommand('comprar leite')).toEqual({
        intent: 'CREATE_TASK',
        args: { rawText: 'comprar leite' },
      });
    });

    it('trims whitespace from rawText', () => {
      expect(parseCommand('  comprar leite  ')).toEqual({
        intent: 'CREATE_TASK',
        args: { rawText: 'comprar leite' },
      });
    });

    it('returns CREATE_TASK with empty rawText for empty string', () => {
      expect(parseCommand('')).toEqual({
        intent: 'CREATE_TASK',
        args: { rawText: '' },
      });
    });
  });
});
